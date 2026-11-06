// Fixture: the overlay panel recipe with the Dock-safe option.
const panel = new BrowserWindow({ type: 'panel', frame: false, transparent: true, vibrancy: 'hud' });
panel.setAlwaysOnTop(true, 'screen-saver');
panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
panel.showInactive();
