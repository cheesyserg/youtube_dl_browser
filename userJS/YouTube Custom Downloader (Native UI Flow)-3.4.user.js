// ==UserScript==
// @name         YouTube Custom Downloader (Native UI Flow)
// @namespace    http://tampermonkey.net/
// @version      3.4
// @description  Adds a custom download options UI that looks native in both Dark and Light modes. Implements robust theme detection and dynamic class management to finally fix all hover color inversion issues.
// @author       Gemini and KDRN
// @match        *://www.youtube.com/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // --- CONFIGURATION ---
    const SERVER_BASE_URL = 'http://127.0.0.1:5000';
    let currentVideoURL = null;

    // --- UTILITY FUNCTION for Theme Detection (V3.4 Fix) ---
    function isLightMode() {
        // The most reliable check for YouTube: Dark Mode means the 'dark' attribute is present on <html>.
        // Light Mode means it is absent.
        return !document.documentElement.hasAttribute('dark');
    }
    // ------------------------------------------

    // --- CSS STYLES (GM_addStyle) ---
    GM_addStyle(`
        /* ------------------------------------------------------------------ */
        /* --- BUTTON STYLING (Dark Mode Default / YT Variables) --- */
        /* ------------------------------------------------------------------ */
        .yt-dlp-action-button-container {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 36px;
            margin-left: 8px;
            border-radius: 18px;

            /* Dark mode base/fallback colors */
            background-color: var(--yt-spec-badge-chip-background, hsla(0,0%,100%,0.1));
            color: var(--yt-spec-text-primary, #fff);
            fill: var(--yt-spec-text-primary, #fff);

            font-family: "Roboto", "Arial", sans-serif;
            font-size: 14px;
            font-weight: 500;
            line-height: 20px;
            cursor: pointer;
            transition: background-color 0.1s ease-in-out;
            padding: 0 16px;
        }

        /* Dark mode hover (V3.3 FIX: Uses explicit dark color and only applies if light-mode class is NOT present) */
        .yt-dlp-action-button-container:not(.yt-dlp-light-mode):hover {
            background-color: #3f3f3f;
        }

        .yt-dlp-action-button-container button {
            background: none;
            border: none;
            color: inherit;
            font-family: inherit;
            font-size: inherit;
            font-weight: inherit;
            cursor: inherit;
            display: flex;
            align-items: center;
            padding: 0;
        }
        .yt-dlp-action-button-container svg {
            fill: inherit;
            width: 24px;
            height: 24px;
            margin-right: 6px;
            flex-shrink: 0;
        }

        /* ------------------------------------------------------------------ */
        /* --- LIGHT MODE BUTTON OVERRIDES (V3.3 FIX) ---- */
        /* ------------------------------------------------------------------ */
        .yt-dlp-light-mode.yt-dlp-action-button-container {
            background-color: #f2f2f2 !important; /* Force Light Gray base color */
            color: #0f0f0f !important; /* Force Dark Text */
            fill: #0f0f0f !important; /* Force Dark Icon */
        }
        .yt-dlp-light-mode.yt-dlp-action-button-container:hover {
            background-color: #e5e5e5 !important; /* Force requested light hover color */
        }
        /* ------------------------------------------------------------------ */


        /* Dark Background Backdrop (Stays dark for visibility) */
        .yt-dlp-backdrop {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.6);
            z-index: 99998;
        }

        /* Floating Download Dialog (Dark Mode Default) */
        .yt-dlp-floating-window {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 380px;
            background-color: #282828;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
            z-index: 99999;
            font-family: "YouTube Noto", "Roboto", Arial, sans-serif;
            color: #f1f1f1;
            padding: 0;
            overflow: hidden;
        }
        .yt-dlp-window-header {
            font-size: 18px;
            font-weight: 500;
            padding: 20px 24px 10px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            margin-bottom: 10px;
        }
        .yt-dlp-window-content {
            padding: 10px 24px 20px;
        }

        /* Radio Button Styling (Dark Mode Default) */
        .yt-dlp-quality-option {
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
            font-size: 15px;

            /* V3.3 Hover Fix: Make it a hoverable block */
            padding: 5px;
            margin: 0 -5px 10px -5px; /* Adjust margin for padding */
            border-radius: 4px;
            transition: background-color 0.1s;
        }
        .yt-dlp-quality-option:hover {
            background-color: #3f3f3f; /* Dark Mode Hover */
        }

        .yt-dlp-quality-option input[type="radio"] {
            appearance: none;
            -webkit-appearance: none;
            width: 20px;
            height: 20px;
            border: 2px solid #aaa;
            border-radius: 50%;
            margin-right: 15px;
            position: relative;
            cursor: pointer;
            outline: none;
            transition: border-color 0.2s;
            flex-shrink: 0;
        }
        .yt-dlp-quality-option input[type="radio"]:checked {
            border-color: #3ea6ff;
        }
        .yt-dlp-quality-option input[type="radio"]:checked::before {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background-color: #3ea6ff;
        }
        .yt-dlp-quality-option-text {
            color: #f1f1f1;
            line-height: 1.4;
        }
        .yt-dlp-quality-option-size {
            color: #aaa;
            font-size: 14px;
        }
        #yt-dlp-status-message {
            color: #aaa;
        }

        /* Action Buttons at the bottom (Dark Mode Default) */
        .yt-dlp-dialog-actions {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 24px 20px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            background-color: #202020;
        }
        .yt-dlp-dialog-actions button {
            min-width: 70px;
            height: 36px;
            padding: 0 16px;
            border-radius: 18px;
            font-size: 14px;
            font-weight: 500;
            line-height: 20px;
            cursor: pointer;
            transition: background-color 0.1s ease-in-out, color 0.1s ease-in-out;
            margin-left: 10px;
            border: none;
        }
        .yt-dlp-dialog-actions #yt-dlp-cancel-btn {
            background-color: transparent;
            color: #aaa;
        }
        .yt-dlp-dialog-actions #yt-dlp-cancel-btn:hover {
            background-color: hsla(0,0%,100%,0.08);
            color: #fff;
        }
        .yt-dlp-dialog-actions #yt-dlp-start-download-btn {
            background-color: #3ea6ff;
            color: #0f0f0f;
        }
        .yt-dlp-dialog-actions #yt-dlp-start-download-btn:hover {
            background-color: #62b1f8;
        }
        .yt-dlp-dialog-actions #yt-dlp-start-download-btn:disabled {
            background-color: #555;
            color: #bbb;
            cursor: not-allowed;
        }
        #yt-dlp-queue-link {
            text-decoration: none;
            color: #fff;
            font-size: 14px;
            font-weight: 500;
            padding: 8px;
            border-radius: 4px;
            transition: background-color 0.1s;
        }
        #yt-dlp-queue-link:hover {
            background-color: hsla(0,0%,100%,0.1);
        }

        /* ------------------------------------------------------------------ */
        /* --- LIGHT MODE DIALOG OVERRIDES (V3.3 FIX) ----------------------- */
        /* ------------------------------------------------------------------ */
        .yt-dlp-light-mode.yt-dlp-floating-window {
            background-color: #ffffff !important;
            color: #0f0f0f !important;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2) !important;
        }
        .yt-dlp-light-mode .yt-dlp-window-header {
            border-bottom: 1px solid #e5e5e5 !important;
        }

        /* V3.3 FIX: Light mode hover for quality options */
        .yt-dlp-light-mode .yt-dlp-quality-option:hover {
            background-color: #e5e5e5 !important;
        }

        .yt-dlp-light-mode .yt-dlp-quality-option input[type="radio"] {
            border: 2px solid #606060 !important;
        }
        .yt-dlp-light-mode .yt-dlp-quality-option-text {
            color: #0f0f0f !important;
        }
        .yt-dlp-light-mode .yt-dlp-quality-option-size {
            color: #606060 !important;
        }
        .yt-dlp-light-mode #yt-dlp-status-message {
            color: #606060 !important;
        }
        .yt-dlp-light-mode .yt-dlp-dialog-actions {
            border-top: 1px solid #e5e5e5 !important;
            background-color: #ffffff !important;
        }
        .yt-dlp-light-mode .yt-dlp-dialog-actions #yt-dlp-cancel-btn {
            background-color: transparent !important;
            color: #606060 !important;
        }
        .yt-dlp-light-mode .yt-dlp-dialog-actions #yt-dlp-cancel-btn:hover {
            background-color: rgba(0,0,0,0.08) !important;
            color: #0f0f0f !important;
        }
        .yt-dlp-light-mode #yt-dlp-queue-link {
            color: #065fd4 !important;
        }
        .yt-dlp-light-mode #yt-dlp-queue-link:hover {
            background-color: rgba(0,0,0,0.05) !important;
        }
        /* ------------------------------------------------------------------ */

        /* Bottom-Left Notification Styling (Stays light for visibility) */
        #yt-dlp-notification {
            position: fixed;
            bottom: 24px;
            left: 24px;
            width: 300px;
            background-color: white;
            color: black;
            padding: 12px 16px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
            z-index: 100000;
            display: flex;
            flex-direction: column;
            font-family: "Roboto", Arial, sans-serif;
            opacity: 1;
            transition: opacity 0.5s ease-out;
        }
        #yt-dlp-notification-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 16px;
            font-weight: 500;
            margin-bottom: 8px;
        }
        #yt-dlp-notification-view {
            color: #065fd4;
            text-decoration: none;
            font-weight: 500;
            margin-left: 10px;
            cursor: pointer;
        }
        #yt-dlp-notification-close {
            background: none;
            border: none;
            color: #606060;
            font-size: 20px;
            cursor: pointer;
            padding: 0;
            margin-left: 10px;
        }
        #yt-dlp-notification-status {
            font-size: 14px;
            color: #606060;
            margin-bottom: 8px;
        }
        #yt-dlp-notification-progress-bar {
            width: 100%;
            height: 4px;
            background-color: #e5e5e5;
            border-radius: 2px;
            overflow: hidden;
        }
        #yt-dlp-notification-progress-bar::after {
            content: '';
            display: block;
            height: 100%;
            width: 100%;
            background-color: #065fd4;
            transition: width 0.3s ease-in-out;
            transform: translateX(-100%);
            animation: pulse 1.5s infinite;
        }
        @keyframes pulse {
            0% { transform: scaleX(0); opacity: 0.5; }
            50% { transform: scaleX(0.8); opacity: 1; }
            100% { transform: scaleX(0); opacity: 0.5; }
        }
    `);

    // --- HTML TEMPLATE for Floating Window (omitted for brevity) ---
    const FLOATING_WINDOW_HTML = `
        <div class="yt-dlp-window-header">Download Quality</div>
        <div class="yt-dlp-window-content">

            <label class="yt-dlp-quality-option">
                <div class="yt-dlp-quality-option-left">
                    <input type="radio" name="download-format" value="best">
                    <span class="yt-dlp-quality-option-text">Best Available (Highest Resolution)</span>
                </div>
                <span class="yt-dlp-quality-option-size" data-size="best">~Auto</span>
            </label>

            <label class="yt-dlp-quality-option">
                <div class="yt-dlp-quality-option-left">
                    <input type="radio" name="download-format" value="1080p">
                    <span class="yt-dlp-quality-option-text">Full HD (1080p)</span>
                </div>
                <span class="yt-dlp-quality-option-size" data-size="1080p">~650 MB</span>
            </label>
            <label class="yt-dlp-quality-option">
                <div class="yt-dlp-quality-option-left">
                    <input type="radio" name="download-format" value="720p">
                    <span class="yt-dlp-quality-option-text">High (720p)</span>
                </div>
                <span class="yt-dlp-quality-option-size" data-size="720p">~150 MB</span>
            </label>
            <label class="yt-dlp-quality-option">
                <div class="yt-dlp-quality-option-left">
                    <input type="radio" name="download-format" value="480p">
                    <span class="yt-dlp-quality-option-text">Standard (480p)</span>
                </div>
                <span class="yt-dlp-quality-option-size" data-size="480p">~90 MB</span>
            </label>

            <label class="yt-dlp-quality-option" style="margin-top: 20px;">
                <div class="yt-dlp-quality-option-left">
                    <input type="radio" name="download-format" value="audio_mp3">
                    <span class="yt-dlp-quality-option-text">Audio Only (MP3)</span>
                </div>
                <span class="yt-dlp-quality-option-size" data-size="audio_mp3">~10 MB</span>
            </label>
            <label class="yt-dlp-quality-option">
                <div class="yt-dlp-quality-option-left">
                    <input type="radio" name="download-format" value="audio_opus">
                    <span class="yt-dlp-quality-option-text">Audio Only (Opus)</span>
                </div>
                <span class="yt-dlp-quality-option-size" data-size="audio_opus">~5 MB</span>
            </label>

            <div id="yt-dlp-status-message" style="margin-top: 20px; font-size: 13px; text-align: center;">Ready.</div>
        </div>
        <div class="yt-dlp-dialog-actions">
            <a href="${SERVER_BASE_URL}" id="yt-dlp-queue-link" target="_blank">Your Downloads</a>
            <div>
                <button id="yt-dlp-cancel-btn">Cancel</button>
                <button id="yt-dlp-start-download-btn" disabled>Download</button>
            </div>
        </div>
    `;

    // Closes the floating window AND removes the backdrop
    function closeFloatingWindow() {
        const windowDiv = document.getElementById('yt-dlp-floating-window');
        const backdropDiv = document.getElementById('yt-dlp-backdrop');
        if (windowDiv) {
            windowDiv.remove();
        }
        if (backdropDiv) {
            backdropDiv.remove();
        }
    }

    // Function to display the bottom-left notification
    function showNotification() {
        // Remove any existing notification first
        const existingNotification = document.getElementById('yt-dlp-notification');
        if (existingNotification) existingNotification.remove();

        const notificationDiv = document.createElement('div');
        notificationDiv.id = 'yt-dlp-notification';

        notificationDiv.innerHTML = `
            <div id="yt-dlp-notification-header">
                <span>Downloading...</span>
                <a href="${SERVER_BASE_URL}" id="yt-dlp-notification-view" target="_blank">View</a>
                <button id="yt-dlp-notification-close">&times;</button>
            </div>
            <div id="yt-dlp-notification-status">Keep this window open to continue</div>
            <div id="yt-dlp-notification-progress-bar"></div>
        `;

        document.body.appendChild(notificationDiv);

        // Add event listener to close button
        document.getElementById('yt-dlp-notification-close').addEventListener('click', () => {
            notificationDiv.remove();
            clearTimeout(window.notificationTimeout);
        });

        // Auto-hide the notification after 2 seconds
        window.notificationTimeout = setTimeout(() => {
            const currentNotification = document.getElementById('yt-dlp-notification');
            if (currentNotification) {
                // Apply fade out effect before removal
                currentNotification.style.opacity = '0';
                // Remove the element after the transition
                setTimeout(() => currentNotification.remove(), 500);
            }
        }, 5000);
    }


    // Queues the current video job to the server (omitted for brevity)
    async function queueCurrentJob() {
        const downloadBtn = document.getElementById('yt-dlp-start-download-btn');
        const selectedFormatRadio = document.querySelector('input[name="download-format"]:checked');
        const statusMsg = document.getElementById('yt-dlp-status-message');

        if (!currentVideoURL || !selectedFormatRadio) {
            statusMsg.textContent = "Please select a download quality.";
            return;
        }

        const selectedFormat = selectedFormatRadio.value;

        // --- UI Setup ---
        downloadBtn.disabled = true;
        statusMsg.textContent = 'Sending job to server queue...';

        try {
            const response = await fetch(`${SERVER_BASE_URL}/api/queue_job`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ url: currentVideoURL, format: selectedFormat })
            });

            const result = await response.json();

            if (result.status === 'queued') {
                // 1. Close the dialog and backdrop
                closeFloatingWindow();

                // 2. Show the native-style notification
                showNotification();

            } else {
                statusMsg.textContent = `Server Error: ${result.message}`;
                console.error("Failed to queue job:", result.message);
            }
        } catch (error) {
            console.error('Initial network error:', error);
            statusMsg.textContent = 'Fatal Network Error. Is the Python server running?';
        } finally {
            if (statusMsg.textContent.includes("Error")) {
                downloadBtn.disabled = false;
            }
        }
    }


    // Creates and displays the floating options window AND the backdrop
    function openDownloadOptionsWindow() {
        if (document.getElementById('yt-dlp-floating-window')) return;

        currentVideoURL = window.location.href;

        // 1. Create and append the backdrop
        const backdropDiv = document.createElement('div');
        backdropDiv.id = 'yt-dlp-backdrop';
        backdropDiv.className = 'yt-dlp-backdrop';
        backdropDiv.addEventListener('click', closeFloatingWindow);
        document.body.appendChild(backdropDiv);

        // 2. Create and append the modal window
        const windowDiv = document.createElement('div');
        windowDiv.id = 'yt-dlp-floating-window';
        windowDiv.className = 'yt-dlp-floating-window';

        // V3.4 Fix: Apply/Remove light-mode class dynamically
        if (isLightMode()) {
            windowDiv.classList.add('yt-dlp-light-mode');
        } else {
            windowDiv.classList.remove('yt-dlp-light-mode');
        }

        windowDiv.innerHTML = FLOATING_WINDOW_HTML;
        document.body.appendChild(windowDiv);

        // --- Event Listeners for the Window ---
        document.getElementById('yt-dlp-cancel-btn').addEventListener('click', closeFloatingWindow);
        const downloadBtn = document.getElementById('yt-dlp-start-download-btn');
        downloadBtn.addEventListener('click', queueCurrentJob);

        const radioButtons = document.querySelectorAll('input[name="download-format"]');
        radioButtons.forEach(radio => {
            radio.addEventListener('change', () => {
                downloadBtn.disabled = !document.querySelector('input[name="download-format"]:checked');
            });
        });

        // Default selection: Best Available
        const defaultRadio = document.querySelector('input[name="download-format"][value="best"]');
        if (defaultRadio) {
            defaultRadio.checked = true;
            downloadBtn.disabled = false;
        }

        document.getElementById('yt-dlp-status-message').textContent = `Ready to queue: ${currentVideoURL.substring(0, 40)}...`;
    }

    // -----------------------------------------------------------
    // --- START: NAVIGATION AND BUTTON MANAGEMENT FIX (V2.5) ---
    // -----------------------------------------------------------

    // 1. Injects the custom "Download Video" button
    function injectButtons() {
        const actionButtonsContainer = document.querySelector('ytd-menu-renderer.ytd-watch-metadata > div:nth-child(1)');
        const shareButtonAnchor = document.querySelector(
            'ytd-menu-renderer.ytd-watch-metadata > div:nth-child(1) > yt-button-view-model:nth-child(2) > button-view-model:nth-child(1)'
        );

        if (shareButtonAnchor && actionButtonsContainer && !document.getElementById('yt-dlp-download-button-container')) {

            const oldQueueBtn = document.getElementById('yt-dlp-queue-button-container');
            if(oldQueueBtn) oldQueueBtn.remove();

            const downloadButtonContainer = document.createElement('div');
            downloadButtonContainer.id = 'yt-dlp-download-button-container';
            downloadButtonContainer.className = 'yt-dlp-action-button-container';

            // V3.4 Fix: Apply/Remove light-mode class dynamically on button
            if (isLightMode()) {
                downloadButtonContainer.classList.add('yt-dlp-light-mode');
            } else {
                 downloadButtonContainer.classList.remove('yt-dlp-light-mode');
            }

            const downloadButton = document.createElement('button');
            downloadButton.id = 'yt-dlp-download-button';
            downloadButton.innerHTML = `
                <svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" style="pointer-events: none; display: block;">
                    <g>
                        <path d="M17 11L12 16L7 11H10V3H14V11H17ZM5 19H19V21H5V19Z"></path>
                    </g>
                </svg>
                Download
            `;
            downloadButton.addEventListener('click', openDownloadOptionsWindow);
            downloadButtonContainer.appendChild(downloadButton);

            actionButtonsContainer.insertBefore(downloadButtonContainer, shareButtonAnchor.nextSibling);

            console.log("Custom Download Button Injected.");
        }
    }

    // Function to remove the button explicitly when the URL changes
    function removeButton() {
        const btnContainer = document.getElementById('yt-dlp-download-button-container');
        if (btnContainer) {
            btnContainer.remove();
            console.log("Custom Download Button Removed.");
        }
    }

    let lastUrl = location.href;

    function observeUrlChanges() {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            removeButton();
            closeFloatingWindow();
            runInjectionCheck();
        }
    }

    function runInjectionCheck() {
        if (window.buttonCheckInterval) {
            clearInterval(window.buttonCheckInterval);
        }

        window.buttonCheckInterval = setInterval(injectButtons, 500);

        setTimeout(() => {
            if (window.buttonCheckInterval) {
                clearInterval(window.buttonCheckInterval);
            }
        }, 10000);
    }

    function initializeScript() {
        runInjectionCheck();
        setInterval(observeUrlChanges, 200);
    }

    initializeScript();

    // -----------------------------------------------------------
    // --- END: NAVIGATION AND BUTTON MANAGEMENT FIX (V2.5) ---
    // -----------------------------------------------------------
})();