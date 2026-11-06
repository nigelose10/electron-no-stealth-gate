// Fixture: direct window stealth calls. Every line below must be flagged.
win.setContentProtection(true);
win.setHiddenInMissionControl(true);
new BrowserWindow({ skipTaskbar: true });
new BrowserWindow({ hiddenInMissionControl: true });
app.dock.hide();
app.dock?.hide();
app.dock['hide']();
app.setActivationPolicy('accessory');
win.setWindowToolWindow?.(true);
new BrowserWindow({ type: 'toolbar' });
const style = WS_EX_TOOLWINDOW;
