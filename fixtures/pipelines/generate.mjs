// Writes the golden pipelines in this folder. Each invalid file is a small, named mutation of a valid one.
// Usage: node fixtures/pipelines/generate.mjs
import fs from 'node:fs';
import path from 'node:path';

const dir = import.meta.dirname;
const param = (value, source = 'default') => ({ value, source });
const node = (id, type, inputs, params = {}, fit = false) => ({
  id,
  type,
  ...(inputs ? { inputs } : {}),
  ...(fit ? { fit_on: 'train' } : {}),
  params,
});
const base = (task, metric, columns, nodes) => ({
  schemaVersion: '0.1',
  project: { name: 'Golden example', seed: 42, mode: 'guided' },
  dataset: { source: { kind: 'local-file', name: 'example.csv' }, rows: 1000, columns },
  task: { type: task, primaryMetric: metric },
  nodes,
});
const clone = (x) => JSON.parse(JSON.stringify(x));
const find0 = (p, id) => p.nodes.find((n) => n.id === id);
const SPLIT = { ratios: param([0.7, 0.15, 0.15]), strategy: param('random') };

const numeric = [
  { name: 'area', dtype: 'float', role: 'feature' },
  { name: 'rooms', dtype: 'int', role: 'feature' },
  { name: 'price', dtype: 'float', role: 'target' },
];
const mixed = [
  { name: 'id', dtype: 'int', role: 'exclude' },
  { name: 'area', dtype: 'float', role: 'feature' },
  { name: 'city', dtype: 'category', role: 'feature' },
  { name: 'label', dtype: 'int', role: 'target' },
];
const grouping = [
  { name: 'customer_id', dtype: 'int', role: 'exclude' },
  { name: 'age', dtype: 'float', role: 'feature' },
  { name: 'income', dtype: 'float', role: 'feature' },
  { name: 'segment', dtype: 'category', role: 'reference' },
];

const regression = base('regression', 'rmse', numeric, [
  node('n1', 'load_csv', null),
  node('n2', 'split', ['n1'], SPLIT),
  node('n3', 'model', ['n2'], { algorithm: param('linear_regression', 'user') }),
  node('n4', 'validate', ['n3'], { method: param('kfold'), k: param(5) }),
]);

const classification = base('classification', 'f1', mixed, [
  node('n1', 'load_csv', null),
  node('n2', 'split', ['n1'], { ...SPLIT, strategy: param('stratified', 'suggested') }),
  node(
    'n3',
    'impute',
    ['n2'],
    { columns: param(['area'], 'user'), strategy: param('median', 'suggested') },
    true,
  ),
  node('n4', 'encode', ['n3'], { columns: param(['city'], 'user'), method: param('onehot') }, true),
  node('n5', 'scale', ['n4'], { method: param('standard') }, true),
  node('n6', 'model', ['n5'], {
    algorithm: param('random_forest', 'user'),
    n_estimators: param(200, 'user'),
  }),
  node('n7', 'validate', ['n6'], { method: param('stratified_kfold'), k: param(5) }),
  node('n8', 'test', ['n7']),
  node('n9', 'export_model', ['n8'], { format: param('bundle') }),
]);

const classificationDropText = clone(classification);
classificationDropText.nodes = [
  node('n1', 'load_csv', null),
  node('n2', 'split', ['n1'], SPLIT),
  node('n3', 'drop_columns', ['n2'], { columns: param(['city'], 'user') }),
  node('n4', 'model', ['n3'], { algorithm: param('logistic_regression', 'user') }),
  node('n5', 'validate', ['n4'], {}),
];

const clustering = base('clustering', 'silhouette', grouping, [
  node('n1', 'load_csv', null),
  node('n2', 'split', ['n1'], { strategy: param('none'), ratios: param([1, 0, 0]) }),
  node('n3', 'scale', ['n2'], { method: param('standard') }, true),
  node('n4', 'model', ['n3'], {
    algorithm: param('kmeans', 'user'),
    n_clusters: param(4, 'suggested'),
  }),
  node('n5', 'stability_check', ['n4'], {}),
]);

const inactive = clone(classification);
find0(inactive, 'n3').params.fillValue = param('x');
find0(inactive, 'n3').params.knnNeighbors = param(9999);

const valid = {
  'regression-minimal': regression,
  'classification-full': classification,
  'classification-drop-text': classificationDropText,
  'clustering-basic': clustering,
  'inactive-settings-ignored': inactive,
};

const invalid = {};
const mutate = (name, expect, from, change) => {
  const copy = clone(from);
  change(copy);
  invalid[name] = { expect, pipeline: copy };
};
const find = (p, id) => p.nodes.find((n) => n.id === id);

mutate('missing-project', ['E_SCHEMA'], regression, (p) => delete p.project);
mutate('missing-fit-on', ['E_SCHEMA'], classification, (p) => delete find(p, 'n3').fit_on);
mutate('duplicate-id', ['E_DUP_ID'], regression, (p) => (find(p, 'n3').id = 'n2'));
mutate('unknown-input', ['E_UNKNOWN_INPUT'], regression, (p) => (find(p, 'n3').inputs = ['n9']));
mutate('cycle', ['E_CYCLE'], regression, (p) => {
  find(p, 'n2').inputs = ['n3'];
  p.nodes.push(node('n5', 'drop_columns', ['n2'], { columns: param(['rooms']) }));
  find(p, 'n3').inputs = ['n5'];
});
mutate('two-sources', ['E_SOURCE_COUNT'], regression, (p) =>
  p.nodes.push(node('n0', 'load_csv', null)),
);
mutate('no-split', ['E_NO_SPLIT'], regression, (p) => {
  p.nodes = [
    p.nodes[0],
    node('n3', 'model', ['n1'], { algorithm: param('linear_regression') }),
    node('n4', 'validate', ['n3'], {}),
  ];
});
mutate('two-splits', ['E_MULTI_SPLIT'], regression, (p) => {
  p.nodes.splice(2, 0, node('n2b', 'split', ['n2'], SPLIT));
  find(p, 'n3').inputs = ['n2b'];
});
mutate('model-before-split', ['E_MODEL_BEFORE_SPLIT'], regression, (p) => {
  find(p, 'n3').inputs = ['n1'];
});
mutate('leak-impute-before-split', ['E_LEAK'], regression, (p) => {
  p.nodes = [
    node('n1', 'load_csv', null),
    node('n1b', 'impute', ['n1'], { columns: param(['area']), strategy: param('median') }, true),
    node('n2', 'split', ['n1b'], SPLIT),
    node('n3', 'model', ['n2'], { algorithm: param('linear_regression') }),
    node('n4', 'validate', ['n3'], {}),
  ];
});
mutate('evaluation-without-model', ['E_NO_MODEL_UPSTREAM'], regression, (p) => {
  p.nodes = [p.nodes[0], p.nodes[1], node('n4', 'validate', ['n2'], {})];
});
mutate('test-without-validate', ['E_TEST_WITHOUT_VALIDATE'], regression, (p) => {
  p.nodes = [p.nodes[0], p.nodes[1], p.nodes[2], node('n5', 'test', ['n3'])];
});
mutate('test-twice', ['E_TEST_TWICE'], regression, (p) => {
  p.nodes.push(node('n5', 'test', ['n4']), node('n6', 'test', ['n4']));
});
mutate('test-feeds-back', ['E_TEST_FEEDBACK'], regression, (p) => {
  p.nodes.push(node('n5', 'test', ['n4']), node('n6', 'tune', ['n5'], { method: param('random') }));
});
mutate('unencoded-text-to-model', ['E_NON_NUMERIC_FEATURE'], classification, (p) => {
  p.nodes = [
    node('n1', 'load_csv', null),
    node('n2', 'split', ['n1'], SPLIT),
    node('n3', 'scale', ['n2'], { method: param('standard') }, true),
    node('n4', 'model', ['n3'], { algorithm: param('random_forest') }),
    node('n5', 'validate', ['n4'], {}),
  ];
});
mutate('no-target', ['E_TARGET'], regression, (p) => (p.dataset.columns[2].role = 'exclude'));
mutate('duplicate-column', ['E_DUP_COLUMN'], regression, (p) =>
  p.dataset.columns.push({ ...p.dataset.columns[0] }),
);
mutate(
  'reference-in-supervised',
  ['E_REFERENCE_ROLE'],
  regression,
  (p) => (p.dataset.columns[1].role = 'reference'),
);
mutate(
  'clustering-with-target',
  ['E_TARGET_IN_CLUSTERING'],
  clustering,
  (p) => (p.dataset.columns[3].role = 'target'),
);
mutate('clustering-with-test', ['E_TEST_IN_CLUSTERING'], clustering, (p) => {
  p.nodes.push(node('n6', 'validate', ['n4'], {}), node('n7', 'test', ['n6']));
});
mutate('stability-in-supervised', ['E_TASK_MISMATCH'], regression, (p) =>
  p.nodes.push(node('n5', 'stability_check', ['n3'], {})),
);
mutate(
  'split-ratios-sum',
  ['E_SPLIT_RATIOS'],
  regression,
  (p) => (find(p, 'n2').params.ratios = param([0.7, 0.2, 0.2])),
);
mutate(
  'split-none-supervised',
  ['E_SPLIT_STRATEGY'],
  regression,
  (p) => (find(p, 'n2').params.strategy = param('none')),
);

mutate(
  'param-unknown',
  ['E_PARAM_UNKNOWN'],
  regression,
  (p) => (find(p, 'n3').params.bogus = param(1)),
);
mutate(
  'param-required-missing',
  ['E_PARAM_REQUIRED'],
  classification,
  (p) => delete find(p, 'n3').params.columns,
);
mutate(
  'param-required-by-condition',
  ['E_PARAM_REQUIRED'],
  classification,
  (p) => (find(p, 'n3').params.strategy = param('constant')),
);
mutate(
  'param-value-out-of-range',
  ['E_PARAM_VALUE'],
  classification,
  (p) => (find(p, 'n6').params.n_estimators = param(5)),
);
mutate(
  'param-column-missing',
  ['E_PARAM_COLUMN'],
  classification,
  (p) => (find(p, 'n3').params.columns = param(['nope'])),
);
mutate(
  'algorithm-wrong-task',
  ['E_PARAM_VALUE'],
  regression,
  (p) => (find(p, 'n3').params.algorithm = param('kmeans')),
);

const write = (folder, name, data) => {
  fs.mkdirSync(path.join(dir, folder), { recursive: true });
  fs.writeFileSync(path.join(dir, folder, `${name}.json`), JSON.stringify(data, null, 2) + '\n');
};
const manifest = [];
for (const [name, pipeline] of Object.entries(valid)) {
  write('valid', name, pipeline);
  manifest.push({ file: `valid/${name}.json`, valid: true, expect: [] });
}
for (const [name, { expect, pipeline }] of Object.entries(invalid)) {
  write('invalid', name, pipeline);
  manifest.push({ file: `invalid/${name}.json`, valid: false, expect });
}
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `wrote ${Object.keys(valid).length} valid and ${Object.keys(invalid).length} invalid pipelines`,
);
