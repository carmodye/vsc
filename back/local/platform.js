/*
 * Copyright 2011-2016 Abierto Networks, LLC.
 * All rights reserved.
 */

/* global ABCONST, ABNET, ConfigDialog */

var PLATFORM = (function() {
    var NAME = 'LOCAL';
    var STORE = '../../../uploads';
    var RUNNING_LOCAL = false;

    function init() {
        if (!RUNNING_LOCAL) {
            return;
        }

        // do not make getappversion call if app is loaded in preview window
        if (!ABNET.isPreviewMode()) {
            $.ajax({
                url: ABNET.MANAGEMENT_URL + '/getappversion',
                type: 'get',
                cache: false,
                dataType: 'json',
                data: {
                    api: 3,
                    appid: ABCONST.APP_ID
                },
                success: function(response) {
                    localStorage.setItem('appVersion', response.version);
                    service();
                },
                error: function(request, status, error) {
                    console.log(request, status, error);
                    localStorage.setItem('appVersion', '0.0.0');
                }
            });
        }

        // change to true to enable the Linux config dialog on local
        /* eslint-disable-next-line */
        if (false) {
            ABNET.PlatformUtils.loadJS('../../back/jquery-ui.min.js');
            ABNET.PlatformUtils.loadCSS('../../back/jquery-ui.min.css');
            ABNET.PlatformUtils.loadJS('../../back/abnet/config.js');

            $(document).keydown(function (e) {
                if (e.key === 'c' && e.altKey && e.ctrlKey) {
                    ConfigDialog.getConfig();
                }

                // this is for Mac, I can't get the Ctrl-Alt combination...
                if (e.key === 'c' && e.ctrlKey) {
                    ConfigDialog.getConfig();
                }
            });
        }
    }

    function checkIdentity(callback) {
        // always set device name and location so app previews call in with the correct info
        localStorage.setItem('deviceName', ABNET.DEVICE_NAME);
        localStorage.setItem('deviceLocation', ABNET.DEVICE_LOCATION);

        if (!localStorage.getItem('deviceCompany')) {
            localStorage.setItem('deviceCompany', ABNET.DEVICE_COMPANY);
        }

        if (callback && typeof callback === 'function') {
            callback();
        }
        else {
            $(document).trigger('platform:identity');
        }
    }

    function service() {
        var id = ABNET.DEVICE_LOCATION;
        var version = localStorage.getItem('appVersion');
        var deviceInfo = [
            // system
            'n/a', 'n/a', 'n/a', 'n/a', 'n/a',
            // network
            'n/a', 'n/a', 'n/a', 'n/a', 'n/a',
            // picture
            'n/a', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a',
            // firmware
            'n/a'
        ];

        // DS-1323 do not make management call if app is loaded in preview window
        if (ABNET.isPreviewMode()) {
            return;
        }

        $.ajax({
            url: ABNET.MANAGEMENT_URL,
            type: 'get',
            cache: false,
            dataType: 'json',
            data: {
                api: 2,
                id: id,
                v: version,
                deviceinfo: JSON.stringify(deviceInfo)
            },
            success: null,
            error: function(request, status, error) {
                console.log(request, status, error);
            }
        });
    }

    /**
     * On LOCAL file download is a no-op.  STORE points to the local
     * CMS uploads directory.  Custom event 'downloads:finished' triggered
     * immediately.
     *
     * @param {array} files List of files to download
     */
    function downloadFiles(files) {
        var fileNames = [];

        files.forEach(function(file) {
            fileNames.push(file.file);
        });

        if (fileNames.length) {
            //console.log(fileNames);
        }

        $(document).trigger('downloads:finished');
    }

    function reboot() {
        location.reload();
    }

    function restart() {
        location.reload();
    }

    function getIP(callback) {
        var ip = ABNET.MASTER_IP;

        if (callback && typeof callback === 'function') {
            callback(ip);
        }
        else {
            return ip;
        }
    }

    return {
        NAME: NAME,
        STORE: STORE,
        init: init,
        checkIdentity: checkIdentity,
        downloadFiles: downloadFiles,
        reboot: reboot,
        restart: restart,
        getIP: getIP
    };

})();

$(document).ready(PLATFORM.init);
