# Windows machine notes (run 2)

Run on 2026-11-09. Compared with the Mac numbers in [spike-results.md](../../../docs/research/spike-results.md).

| Item | Value |
|---|---|
| Machine | Alienware laptop, label `win-desktop` |
| CPU | Intel Core Ultra 9 185H (22 logical processors) |
| RAM | 15.5 GB |
| GPU | NVIDIA GeForce RTX 4060 Laptop (8 GB), driver 616.56; also Intel Arc integrated graphics |
| Windows | Windows 11 Home, version 10.0.26300 |
| Browsers | Chrome 157.0.8103.38 and Edge 157.0.4341.42, both run headless (`--headless=new`) with a fresh profile and no extensions |
| Python (native baseline and GPU) | 3.14.7 in a venv inside the folder; numpy 2.4.6, pandas 3.0.2, scikit-learn 1.8.0, scipy 1.18.0, XGBoost 2.1.4, pyarrow 22.0.0 |
| Node.js | 22.23.4, portable zip, checksum verified |
| Pyodide | 314.0.7, same 14 packages as the Mac run |
| Power | Plugged in. The native baseline and all browser batches ran after the user switched Windows to its performance power mode. Windows still reported the "Balanced" power scheme, so the mode setting itself could not be verified from the command line. |
| Background load | Windows Defender real-time protection was on (its scanning process was running). No other apps were started; the machine was left idle during runs. |

## Deviations from WINDOWS.md

- **No conda.** Conda was not installed, so the native environment is a Python venv with the same pinned versions.
- **Portable Node.** Node.js was unpacked from the official zip inside the test folder; nothing was installed system-wide.
- **Headless browsers.** The tests were driven over SSH, so the browsers ran headless. Headless Chrome and Edge reported `crossOriginIsolated=true` and `SharedArrayBuffer` available. Frame-gap numbers come from a headless page and are not a measure of what a user would see on screen.
- **Batch G (cancel without isolation).** On the non-isolated address the cancel test skips its interrupt cases by design and only measures terminate and restart, so its file has an empty `cases` list.
- **Rerun.** The native baseline was started before the power mode change, then stopped and rerun from the start. Only the rerun is kept.

## Not covered

- Firefox (not installed on this machine) and Safari.
- Repeats: each timing was run once (load times three times), not five.
- The Windows Defender effect on load time was not isolated (no run with scanning excluded).
