import {app, ipcMain, BrowserWindow, WebContentsView} from 'electron/main'
import {screen, Menu, MenuItem, shell} from 'electron'

import * as path from 'path'

import {
    executeInWebView,
    scrollPositionScript,
    dimensionsScript,
} from './webContentsView/handlers.js'
import {takeScreenshots} from './mainWindow/utils.js'
import ClickTracker from './trackers/clicks/ClickTracker.js'
import MouseMovementTracker from './trackers/mouse/MouseTracker.js'
import TrackerManager from "./trackers/TrackerManager.js";
import BaseTracker from "./trackers/BaseTracker.js";

// This script is the main entry point for the Electron application.
app.whenReady().then(() => {
    const mainWin = createWindow()
    let webView = null
    const trackerManager = new TrackerManager();
    const clickTracker = new ClickTracker()
    const mouseMovementTracker = new MouseMovementTracker()
    trackerManager.addTracker(clickTracker)
    trackerManager.addTracker(mouseMovementTracker)
    let inputUrl = ''

    ipcMain.on('urlToGo', (_, value) => {
        inputUrl = validateAndFixUrl(value[0])
        console.log('Input value received in main process:', value)
        if (!webView) webView = createWebView(mainWin, value[1], trackerManager.getTrackerByType(BaseTracker.types.CLICK), trackerManager.getTrackerByType(BaseTracker.types.MOUSE_MOVEMENT))

        // Start tracking timer on the first web load
        webView.webContents.once('did-finish-load', () => trackerManager.startTracking())

        handleUrlToGo(inputUrl, mainWin, webView)
    })
    ipcMain.on('backAction', () => handleBackAction(webView))
    ipcMain.on('forwardAction', () => handleForwardAction(webView))
    ipcMain.on('resetURL', () => handleResetUrl(inputUrl, webView))
    ipcMain.on('endTest', () => handleEndTest(mainWin, webView, trackerManager))
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow()
        }
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

/**
 * Creates a new BrowserWindow with specific configurations.
 *
 * This function creates a new BrowserWindow instance with the following
 * configurations:
 * - Auto-hide menu bar: true
 * - Width: 1200
 * - Height: 800
 * - Preload: preload.js
 *
 * If options are provided, they will override the default configurations.
 *
 * After creating the window, it sets the application menu using the
 * `createMenu` function and loads the 'dist/index.html' file into the window.
 *
 * @param {Electron.BrowserWindowConstructorOptions} [options] - Optional configurations to override the defaults.
 * @returns {BrowserWindow} The newly created BrowserWindow instance.
 */
function createWindow(options = {}) {
    const defaultOptions = {
        autoHideMenuBar: true,
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(new URL('.', import.meta.url).pathname, 'preload.js'),
        },
    }

    const mainWin = new BrowserWindow({...defaultOptions, ...options})

    Menu.setApplicationMenu(createMenu())
    mainWin.loadFile('dist/index.html')

    return mainWin
}

/**
 * Creates a new application menu.
 *
 * This function creates a new Menu instance and populates it with 'View' and 'Help' submenus.
 * The 'View' submenu contains options for reloading the page, toggling fullscreen, zooming in/out,
 * resetting zoom, and toggling developer tools.
 * The 'Help' submenu contains options for opening the documentation, checking for updates, and
 * reporting an issue. Each of these options opens a corresponding URL in the default web browser.
 *
 * @returns {Menu} The newly created Menu instance.
 */
function createMenu() {
    const menu = new Menu()

    const viewMenu = new Menu()
    viewMenu.append(new MenuItem({label: 'Reload', role: 'reload'}))
    viewMenu.append(
        new MenuItem({label: 'Toggle Fullscreen', role: 'togglefullscreen'}),
    )
    viewMenu.append(new MenuItem({label: 'Zoom In', role: 'zoomin'}))
    viewMenu.append(new MenuItem({label: 'Zoom Out', role: 'zoomout'}))
    viewMenu.append(new MenuItem({label: 'Reset Zoom', role: 'resetzoom'}))
    viewMenu.append(
        new MenuItem({label: 'Toggle Developer Tools', role: 'toggledevtools'}),
    )

    const helpMenu = new Menu()
    helpMenu.append(
        new MenuItem({
            label: 'Documentation',
            click: () => {
                shell.openExternal(
                    'https://github.com/ruxailab/heatmap-app',
                )
            },
        }),
    )
    helpMenu.append(
        new MenuItem({
            label: 'Check for Updates',
            click: () => {
                shell.openExternal(
                    'https://github.com/ruxailab/heatmap-app/releases',
                )
            },
        }),
    )
    helpMenu.append(
        new MenuItem({
            label: 'Report an Issue',
            click: () => {
                shell.openExternal(
                    'https://github.com/vGerJ02/ruxailab-testing-app/issues',//currently the issue section is not opened
                )
            },
        }),
    )

    menu.append(new MenuItem({label: 'View', submenu: viewMenu}))
    menu.append(new MenuItem({label: 'Help', submenu: helpMenu}))

    return menu
}

/**
 * Creates a new WebContentsView and sets up event handlers for various WebView events.
 *
 * @param {BrowserWindow} mainWin - The main window in which the WebView is created.
 * @param {number} offsetY - The offset in the Y direction for the WebView.
 * @param {ClickTracker} clickTracker - An object that tracks clicks in the WebView.
 * @param {MouseMovementTracker} mouseMovementTracker - An object that tracks mouse movements in the WebView.
 *
 * @returns {WebContentsView} webView - The created WebView.
 */
function createWebView(mainWin, offsetY, clickTracker, mouseMovementTracker) {
    const webView = new WebContentsView({
        webPreferences: {
            preload: path.join(
                new URL('.', import.meta.url).pathname,
                'preloadView.js',
            ),
        },
    })


    webView.webContents.on('did-finish-load', async () => {
        console.log('[LOG] url finished loading')
        resizeWebView(undefined, offsetY, mainWin, webView)
        const dimensions = await executeInWebView(webView, dimensionsScript)
        if (!dimensions) return

        const url = webView.webContents.getURL()
        clickTracker.setDimensions(url, dimensions.width, dimensions.height)
        console.log('[LOG] dimensions set for url:', url, clickTracker.getDimensions())
        mainWin.webContents.send('webview-load-finished')
    })

    webView.webContents.on('input-event', async (_event, input) => {
        if (input.type === 'mouseDown' || input.type === 'mouseMove') {

            const screenPoint = screen.getCursorScreenPoint()
            const windowPoint = mainWin.getContentBounds()

            const scrollPosition = await executeInWebView(
                webView,
                scrollPositionScript,
            )
            if (!scrollPosition) return

            const x = screenPoint.x - windowPoint.x + scrollPosition.x
            const y = screenPoint.y - windowPoint.y - offsetY + scrollPosition.y

            const url = webView.webContents.getURL()
            if (input.type === 'mouseDown') {
                clickTracker.trackClick(x, y, url)
                console.log('mouse down at:', x, y, url)

                const dimensions = await executeInWebView(webView, dimensionsScript)
                if (!dimensions) return

                clickTracker.setDimensions(url, dimensions.width, dimensions.height)
            } else if (input.type === 'mouseMove') {
                mouseMovementTracker.trackMovement(x, y, url)
                // console.log('mouse move at:', x, y, url)
            }
        }
    })

    webView.webContents.on(
        'did-fail-load',
        (_event, _errorCode, errorDescription) => {
            mainWin.webContents.send('webview-load-failed', errorDescription)
            endWebView(mainWin, webView)
        },
    )

    webView.webContents.on('did-navigate', (_, url) => {
        console.log('Navigating to: ', url)
        mainWin.webContents.send('url-updated', url !== 'about:blank' ? url : '')
    })

    mainWin.on('resize', () => {
        resizeWebView(undefined, offsetY, mainWin, webView)
    })
    return webView
}

/**
 * Handles the action of navigating to a specific URL in a WebView.
 *
 * This function checks if the mainWin, inputUrl, and webView parameters are not null or undefined.
 * If they are not, it adds the WebView as a child view of the mainWin's contentView,
 * makes the WebView visible, and loads the inputUrl into the WebView's webContents.
 *
 * @param {string} inputUrl - The URL to navigate to.
 * @param {BrowserWindow} mainWin - The main BrowserWindow instance.
 * @param {WebContentsView} webView - The WebView instance to navigate in.
 */
function handleUrlToGo(inputUrl, mainWin, webView) {
    if (mainWin && inputUrl && webView) {
        mainWin.contentView.addChildView(webView)
        webView.setVisible(true)
        webView.webContents.loadURL(inputUrl)
    }
}

/**
 * Handles the back action for a given WebView.
 *
 * This function checks if the WebView's webContents can go back in history.
 * If it can, it triggers the goBack action on the webContents.
 *
 * @param {WebContentsView} webView - The WebContentsView instance to handle the back action for.
 */
function handleBackAction(webView) {
    if (webView.webContents.canGoBack()) webView.webContents.goBack()
}

/**
 * Handles the forward action for a given WebView.
 *
 * This function checks if the WebView's webContents can go forward in history.
 * If it can, it triggers the goForward action on the webContents.
 *
 * @param {WebContentsView} webView - The WebContentsView instance to handle the forward action for.
 */
function handleForwardAction(webView) {
    if (webView.webContents.canGoForward()) webView.webContents.goForward()
}

/**
 * Resets the URL of a given WebView.
 *
 * This function checks if the inputUrl is not null or undefined.
 * If it is not, it loads the inputUrl into the WebView's webContents.
 *
 * @param {string} inputUrl - The URL to load into the WebView.
 * @param {WebContentsView} webView - The WebContentsView instance to reset the URL for.
 */
function handleResetUrl(inputUrl, webView) {
    if (inputUrl) webView.webContents.loadURL(inputUrl)
}

/**
 * Handles the end of a test.
 *
 * This function is responsible for closing the developer tools
 * and destroying the web contents of the provided WebView when a test ends.
 * Used once the user has confirmed that the test has ended.
 *
 * @param {BrowserWindow} mainWin - The window where webView is attached to
 * @param {WebContentsView} webView - The WebContentsView whose test has ended.
 * @param {TrackerManager} trackerManager - The TrackerManager instance to get the results from.
 */
function handleEndTest(mainWin, webView, trackerManager) {
    if (webView.webContents) {
        trackerManager.endTracking()
        const results = trackerManager.getResults()

        // Extract specific data from results
        const clickResults = results.find(result => result.type === BaseTracker.types.CLICK) || {clicks: [], time: 0};
        const mouseMovementResults = results.find(result => result.type === BaseTracker.types.MOUSE_MOVEMENT) || {
            movements: [],
            time: 0
        };
        const dimensions = clickResults.dimensions || mouseMovementResults.dimensions || new Map()

        mainWin.webContents.send('end-clicks', clickResults.clicks, clickResults.time, dimensions)
        mainWin.webContents.send('end-mouse', mouseMovementResults.movements, mouseMovementResults.time, dimensions)

        trackerManager.reset()
        endWebView(mainWin, webView)

        takeScreenshots(dimensions, (progress, failedUrls) =>
            mainWin.webContents.send('screenshots-progress', progress, failedUrls),
        )
            .then((images) => {
                mainWin.webContents.send('end-screenshots', images)
            })
            .catch((e) => {
                console.error(e)
            })
    }
}

/**
 * Ends the session of a given WebView in a BrowserWindow.
 *
 * This function loads 'about:blank' into the WebView's webContents,
 * makes the WebView invisible, and removes the WebView from the mainWin's contentView.
 *
 * @param {BrowserWindow} mainWin - The main BrowserWindow instance.
 * @param {WebContentsView} webView - The WebContentsView instance to end the session for.
 */
function endWebView(mainWin, webView) {
    webView.webContents.loadURL('about:blank')
    webView.setVisible(false)
    mainWin.contentView.removeChildView(webView)
}


/**
 * Validates a given URL.
 *
 * Checks if the inputUrl starts with 'http://' or 'https://'.
 * If it doesn't, it prepends 'https://' to the inputUrl.
 *
 * @param {string} inputUrl - The URL to validate and fix.
 * @returns {string} The validated and fixed URL.
 */
function validateAndFixUrl(inputUrl) {
    const urlRegex = /^(https?):\/\//
    return urlRegex.test(inputUrl) ? inputUrl : 'https://' + inputUrl
}

/**
 * Resizes a WebContentsView within a BrowserWindow.
 *
 * This function adjusts the bounds of the WebView to fit within the content bounds of the mainWindow.
 * The offsetX and offsetY parameters specify the top-left corner of the WebView relative to the mainWindow.
 * If either parameter is undefined, the current position of the WebView is used.
 *
 * @param {number} [offsetX=0] - The x-coordinate of the WebView's top-left corner.
 * @param {number} [offsetY=0] - The y-coordinate of the WebView's top-left corner.
 * @param {BrowserWindow} mainWindow - The main BrowserWindow instance.
 * @param {WebContentsView} webView - The WebContentsView instance to resize.
 */
function resizeWebView(offsetX = 0, offsetY = 0, mainWindow, webView) {
    if (!mainWindow || !webView) {
        console.log('mainWindow or webView not ready')
        return
    }

    const {width, height} = mainWindow.getContentBounds()
    const {x: oldX, y: oldY} = webView.getBounds()

    offsetX = offsetX === undefined ? oldX : offsetX
    offsetY = offsetY === undefined ? oldY : offsetY

    webView.setBounds({
        x: offsetX,
        y: offsetY,
        width: width - offsetX,
        height: height - offsetY,
    })
}
