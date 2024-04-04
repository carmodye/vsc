/*
 * Copyright 2011-2022 Abierto Networks, LLC.
 * All rights reserved.
 */

/* global $, ABNET, b2bapis, SERVER_URL, tizen, webapis */

var PLATFORM = (function () {
    var NAME = 'TIZEN';
    var STORE = 'file:///opt/usr/home/owner/content/Downloads/media';
    var FILES = {
        ALL: [],
        DELETE: [],
        DOWNLOAD: [],
        VERIFY: []
    };
    var ONSCREENLOGGING = false;

    function init() {
        localStorage.removeItem('downloaded');
        localStorage.removeItem('videos');

        var mac = getMac();

        function setItems(data) {
            setLastReboot();

            localStorage.setItem('appVersion', data.version);
            localStorage.setItem('serverVersion', data.server);

            // dce data
            localStorage.setItem('mac', mac);
            localStorage.setItem('deviceName', 'Tizen');
            localStorage.setItem('deviceLocation', mac);
            localStorage.setItem('deviceCompany', 'Abierto');

            var version = localStorage.getItem('version');
            if (!version) {
                localStorage.setItem('version', '0.0.0');
            }

            // device info, system
            localStorage.setItem('infoMake', 'Samsung');
            localStorage.setItem('infoModel', getModel());
            localStorage.setItem('infoSerialnumber', getSerialnumber());
            localStorage.setItem('infoOperatingsystem', 'Tizen');
            localStorage.setItem('infoOsversion', 'n/a');
            localStorage.setItem('infoFirmware', getFirmware());
            // device info, network
            localStorage.setItem('infoIpaddress', getIP());
            localStorage.setItem('infoSubnetmask', getMask());
            localStorage.setItem('infoDefaultgateway', getGateway());
            localStorage.setItem('infoDnsservers', getDns());
            localStorage.setItem('infoDhcp', getDhcp());
            // device info, picture
            localStorage.setItem('infoInput', 'n/a');
            localStorage.setItem('infoAspectratio', '16:9');
            localStorage.setItem('infoPicturemode', 'n/a');
            localStorage.setItem('infoContrast', 'n/a');
            localStorage.setItem('infoBrightness', 'n/a');
            localStorage.setItem('infoAutostandby', 'n/a');

            setInterval(service, ABNET.MANAGEMENT_INTERVAL);
            service();

            ABNET.wsDeviceStatus();
            ABNET.screenshot.timer();

            checkIdentity();
        }

        $.getJSON('appinfo.json', setItems);
    }

    /**
     * This is called directly from script.js
     *
     * @returns {undefined}
     */
    function checkIdentity() {
        $(document).trigger('platform:identity');
    }

    function service() {
        var id = localStorage.getItem('mac');
        var version = localStorage.getItem('appVersion');
        var deviceInfo = deviceInfoToString();

        $.ajax({
            url: ABNET.MANAGEMENT_URL,
            type: 'get',
            cache: false,
            dataType: 'json',
            data: {
                api: 2,
                id: id,
                v: version,
                deviceinfo: deviceInfo
            },
            success: function(data) {
                process(data);
            },
            error: function(request, status, error) {
                console.log(request, status, error);
            }
        });
    }

    function process(data) {
        for (var i = 0; i < data.length; ++i) {
            switch (data[i]['action']) {
                case 'REBOOT':
                    reboot();
                    break;
                case 'RESTART':
                    restart();
                    break;
                case 'UNZIP':
                    upgrade(data[i]['params']);
                    break;
                case 'LOGGING':
                    ABNET.debug.toggle();
                    break;
                case 'PUT':
                    // TODO: implement, send files to server
                    break;
                case 'GET':
                    // TODO: implement, get files from server
                    break;
                default:
                    console.log('unknown action: ' + data[i]['action']);
            }
        }
    }

    function reboot() {
        ABNET.debug.log('platform.reboot()');
        var onSuccess = function() {};

        var onError = function(error) {
            log('rebootDevice', error);
        };

        try {
            b2bapis.b2bcontrol.rebootDevice(onSuccess, onError);
        }
        catch (e) {
            log('rebootDevice', e);
        }
    }

    function setLastReboot() {
        var date = new Date();
        var datetime = date.toISOString();

        localStorage.setItem('lastreboot', datetime);
        ABNET.debug.log('platform.setLastReboot:', datetime);
    }

    function restart() {
        ABNET.debug.log('platform.restart()');
        reboot();
    }

    function upgrade(params) {
        ABNET.debug.log('platform.upgrade() appUri:', params);
        var onSuccess = function() {
            reboot();
        };

        var onError = function(error) {
            log('setURLLauncherAddress', error);
        };

        try {
            var url = SERVER_URL + '/' + params.substring(0, params.lastIndexOf('/'));

            b2bapis.b2bcontrol.setURLLauncherAddress(url, onSuccess, onError);
        }
        catch (e) {
            log('setURLLauncherAddress', e);
        }
    }

    /**
     * Files download on TIZEN.  Custom event 'downloads:finished' triggered
     * when the list files to be downloded is exhausted.  DOWNLOADED is the
     * list of files downloaded successfully.
     *
     * @param {array} files List of files to download
     */
    function downloadFiles(files) {
        onScreenLog('downloadFiles: ' + files.length);
        FILES = {
            ALL: [],
            DELETE: [],
            DOWNLOAD: [],
            VERIFY: []
        };

        files.forEach(function(file) {
            switch(file.action) {
                case 'delete':
                    FILES.DELETE.push(file.file);
                    break;
                case 'download':
                    FILES.ALL.push(file.file);
                    FILES.DOWNLOAD.push(file.file);
                    break;
                case 'verify':
                    FILES.ALL.push(file.file);
                    FILES.VERIFY.push(file.file);
                    break;
            }
        });

        verifyFilesExist(FILES.VERIFY, function() {
            // make a copy of the download array
            var fileNames = FILES.DOWNLOAD.slice();

            fileNames.forEach(function(file) {
                onScreenLog('download: ' + file);
            });

            downloadToTemp(fileNames);
        });
    }

    function verifyFilesExist(list, callback) {
        var count = 0;

        if (!list.length) {
            callback();
        }

        list.forEach(function(file) {
            onScreenLog('verify: ' + file);
            exists('downloads/media' + file, function(result) {
                count++;

                if (!result) {
                    // file does not exist, add to down download array
                    FILES.DOWNLOAD.push(file);
                }

                if (count === list.length) {
                    callback();
                }
            });
        });
    }

    function exists(file, callback) {
        tizen.filesystem.resolve(file,
            function() {
                onScreenLog('Exists: ' + file);
                callback(true);
            },
            function() {
                onScreenLog('NOT Exists: ' + file);
                callback(false);
            }, 'r');
    }

    /**
     * Called by downloadFiles when files.length is greater than 0. Clears the
     * downloads/temp directory then downloads files to downloads/temp.
     */
    function downloadToTemp(files) {
        // delete files in downloads/temp
        deleteFiles('downloads/temp', false, function() {
            // delete directories in downloads/temp
            deleteDirectories('downloads/temp', function() {
                // create downloads/temp in case it doesn't already exist
                createDirectory('downloads', 'temp', function() {
                    // create directory structure under downloads/temp for incoming files
                    createDirectories('downloads/temp', files, function() {
                        // download files to downloads/temp
                        copyFiles(files);
                    });
                });
            });
        });
    }

    function copyFiles(files) {
        if (!files.length) {
            doneDownloading();

            return;
        }

        var listener = {
            onprogress: function() {},
            onpaused: function() {},
            oncanceled: function() {},
            oncompleted: function() {
                copyFiles(files);
            },
            onfailed: function(id, error) {
                console.log('file download failed: ' + error);
                copyFiles(files);
            }
        };

        var uploads = '/uploads';
        var first = files.shift();
        var src = encodeURI(SERVER_URL + uploads + first);
        var path = 'downloads/temp' + first.slice(0, first.lastIndexOf('/'));
        var downloadRequest = new tizen.DownloadRequest(src, path);

        tizen.download.start(downloadRequest, listener);
    }

    /**
     * Called by copyFiles when files.length has reached 0, clears the downloads/media
     * directory then copies files from downloads/temp to downloads/media. Also triggers
     * 'downloads:finished' and calls cleanup()
     */
    function doneDownloading() {
        // files are done downloading
        // create downloads/media in case it doesn't already exist
        createDirectory('downloads', 'media', function() {
            // create directory structure under downloads/media for incoming files
            createDirectories('downloads/media', FILES.DOWNLOAD, function() {
                onScreenLog('doneDownloading createDirectories callback');
                // copy files from downloads/temp to downloads/media
                copyToMedia('downloads/temp', function() {
                    // let app know downloads have finished
                    $(document).trigger('downloads:finished');
                    // cleanup downloads folder
                    deleteFiles('downloads', true);
                });
            });
        });
    }

    /**
     * Recursively loops through the files/folders under the passed in path and copies
     * them to downloads/media.
     *
     * @param {string} path Path to the directory to cleanup
     */
    function copyToMedia(path, callback) {
        onScreenLog('copyToMedia: ' + path);
        var directory;
        var copycount = 0;

        function onsuccess(files) {
            if (!files.length) {
                callback();
            }

            files.forEach(function(file) {
                onScreenLog('copyToMedia: ' + file.fullPath);
                if (file.isDirectory == false) {
                    var newPath = file.fullPath.replace('downloads/temp', 'downloads/media');

                    directory.copyTo(file.fullPath, newPath, true, function() {
                        onScreenLog('success: ' + newPath );
                        // file successfully copied, increment copycount
                        copycount++;

                        // only call the callback once all files have been copied
                        if (copycount === files.length) {
                            callback();
                        }
                    });
                }
                else {
                    copyToMedia(file.fullPath, callback);
                }
            });
        }

        function onerror(error) {
            console.log('Error ' + error.message + ' occurred when copying files to the selected folder');
            callback();
        }

        resolveDirectory(path,
            function(dir) {
                directory = dir;
                directory.listFiles(onsuccess, onerror);
            },
            onerror);
    }

    /**
     * Loops through a list of files and creates directories needed to store the files
     * under the passed in root directory.
     *
     * @param {string} root The root directory where the directories will be created
     * @param {array} files Array of file names with full path
     */
    function createDirectories(root, files, cb) {
        var cbCount = 0;
        var directories = [];

        if (!files.length) {
            cb();
        }

        // createDirectory callback function
        function cdCallback() {
            cbCount++;
            onScreenLog('createDirectories cb: ' + cbCount + ' ' + directories.length);
            // directory creation is done
            if (cbCount === directories.length) {
                cb();
            }
        }

        // figure out which directories need to be created
        files.forEach(function(file) {
            var filePath = file.slice(1, file.lastIndexOf('/'));
            var paths = filePath.split('/');
            var dir = [];

            paths.forEach(function(path) {
                dir.push(path);

                var directory = dir.join('/');

                if (directories.indexOf(directory) === -1) {
                    directories.push(directory);
                }
            });
        });

        // create the directories
        directories.forEach(function(directory) {
            createDirectory(root, directory, cdCallback);
        });
    }

    /**
     * Creates a sub directory under the passed in root directory.
     *
     * @param {string} root The root directory where the directory will be created
     * @param {string} directory Name of the directory to create
     */
    function createDirectory(root, directory, cb) {
        onScreenLog('createDirectory: ' + directory);

        exists(root + '/' + directory, function(result) {
            if (!result) {
                resolveDirectory(root,
                    function(dir) {
                        dir.createDirectory(directory);
                        onScreenLog('createDirectory: ' + directory);
                        cb();
                    },
                    function(e) {
                        console.log('Error ' + e.message);
                        onScreenLog('createDirectory failed: ' + e.message);
                        cb();
                    });
            }
            else {
                cb();
            }
        });
    }

    /**
     * Recursively loops through the files under the passed in path and deletes them
     *
     * @param {string} path Path to the directory whos files will be deleted
     * @param {boolean} keep Keep files in FILES.ALL true/false
     * @param {function} callback Function called once all files have finished deleting
     */
    function deleteFiles(path, keep, callback) {
        var directory;

        function onsuccess(files) {
            files.forEach(function(file) {
                if (file.isDirectory) {
                    deleteFiles(file.fullPath, keep);
                }
                else {
                    var filename = file.fullPath.replace('downloads/media', '');

                    if (!keep || FILES.ALL.indexOf(filename) === -1) {
                        onScreenLog('deleting: ' + file.fullPath);
                        directory.deleteFile(file.fullPath);
                    }
                }
            });

            if (typeof callback === 'function') {
                callback();
            }
        }

        function onerror(error) {
            console.log('Error ' + error.message + ' occurred when deleting the files in the selected folder');
            if (typeof callback === 'function') {
                callback();
            }
        }

        resolveDirectory(path,
            function(dir) {
                directory = dir;
                directory.listFiles(onsuccess, onerror);
            },
            onerror);
    }

    /**
     * Loops through the directories under the passed in path and deletes them
     *
     * @param {string} path Path to the directory whos files will be deleted
     * @param {function} callback Function called once all files have finished deleting
     */
    function deleteDirectories(path, callback) {
        var directory;

        function onsuccess(files) {
            files.forEach(function(file) {
                if (file.isDirectory) {
                    directory.deleteDirectory(file.fullPath, true);
                }
            });

            callback();
        }

        function onerror(error) {
            console.log('Error ' + error.message + ' occurred when deleting the directories in the selected folder');
            callback();
        }

        resolveDirectory(path,
            function(dir) {
                directory = dir;
                directory.listFiles(onsuccess, onerror);
            },
            onerror);
    }

    /**
     * Gets a read/write handle to a directory in the Tizen file system
     *
     * @param {string} path Path to the directory to resolve
     * @param {function} onsuccess Function called if directory resolves successfully
     * @param {function} onerror Function called if directory fails to resolve
     */
    function resolveDirectory(path, onsuccess, onerror) {
        tizen.filesystem.resolve(path,
            function(dir) {
                onsuccess(dir);
            },
            function(e) {
                onerror(e);
            }, 'rw');
    }

    function deviceInfoToString() {
        var info = [];

        // device info, system
        info.push(localStorage.getItem('infoMake'));
        info.push(localStorage.getItem('infoModel'));
        info.push(localStorage.getItem('infoSerialnumber'));
        info.push(localStorage.getItem('infoOperatingsystem'));
        info.push(localStorage.getItem('infoOsversion'));

        // device info, network
        info.push(localStorage.getItem('infoIpaddress'));
        info.push(localStorage.getItem('infoSubnetmask'));
        info.push(localStorage.getItem('infoDefaultgateway'));
        info.push(localStorage.getItem('infoDnsservers'));
        info.push(localStorage.getItem('infoDhcp'));

        // device info, picture
        info.push(localStorage.getItem('infoInput'));
        info.push(localStorage.getItem('infoAspectratio'));
        info.push(localStorage.getItem('infoPicturemode'));
        info.push(localStorage.getItem('infoContrast'));
        info.push(localStorage.getItem('infoBrightness'));
        info.push(localStorage.getItem('infoAutostandby'));

        // device info, system
        // FIXME: group with the other system info
        info.push(localStorage.getItem('infoFirmware'));

        return JSON.stringify(info);
    }

    function getMac() {
        var mac = null;

        try {
            mac = webapis.network.getMac();
        }
        catch (e) {
            log('getMac', e);
        }

        return mac.replace(/:/g, '').toUpperCase();
    }

    function getModel() {
        var model = null;

        try {
            model = webapis.productinfo.getRealModel();
        }
        catch (e) {
            log('getRealModel', e);
        }

        return model;
    }

    function getSerialnumber() {
        var serial = null;

        try {
            serial = b2bapis.b2bcontrol.getSerialNumber();
        }
        catch (e) {
            log('getSerialNumber', e);
        }

        return serial;
    }

    function getFirmware() {
        var firmware = null;

        try {
            firmware = webapis.productinfo.getFirmware();
        }
        catch (e) {
            log('getFirmware', e);
        }

        return firmware;
    }

    function getIP() {
        var ip = null;

        try {
            ip = webapis.network.getIp();
        }
        catch (e) {
            log('getIP', e);
        }

        return ip;
    }

    function getMask() {
        var mask = null;

        try {
            mask = webapis.network.getSubnetMask();
        }
        catch (e) {
            log('getSubnetMask', e);
        }

        return mask;
    }

    function getGateway() {
        var gateway = null;

        try {
            gateway = webapis.network.getGateway();
        }
        catch (e) {
            log('getGateway', e);
        }

        return gateway;
    }

    function getDns() {
        var dns = null;

        try {
            dns = webapis.network.getDns();
        }
        catch (e) {
            log('getDns', e);
        }

        return dns;
    }

    function getDhcp() {
        var dhcp = null;

        try {
            dhcp = webapis.network.getIpMode();
        }
        catch (e) {
            log('getIpMode', e);
        }

        return dhcp == webapis.network.NetworkIpMode.DYNAMIC ? 'yes' : 'no';
    }

    function screenShot() {

        var onsuccess = function(files) {
            files.forEach(function(file) {
                if (file.name === 'PepperAPIScreenCapture.jpg') {
                    file.openStream('r', function(fs) {
                        var base64 = 'data:image/jpeg;base64,' + fs.readBase64(file.fileSize);

                        fs.close();

                        ABNET.screenshot.put(base64);
                    }, function(e) {
                        console.log('Error ' + e.message);
                    }, 'UTF-8');
                }
            });
        };

        var onerror = function(error) {
            console.log(error);
        };

        var onCaptureSuccess = function() {
            resolveDirectory('/opt/usr/home/owner/share/magicinfo',
                function(directory) {
                    directory.listFiles(onsuccess, onerror);
                },
                onerror);
        };

        var onCaptureError = function(error) {
            console.log('[captureScreen] code :' + error.code + ' error name: ' + error.name + ' message ' + error.message);
        };

        b2bapis.b2bcontrol.captureScreen(onCaptureSuccess, onCaptureError);
    }

    function deviceInfoToObject() {
        return new Promise(function(resolve) {
            var info = {};

            // client
            var client = ABNET.SERVER_URL.replace('http://', '').replace('https://', '');

            info.client = client.slice(0, client.indexOf('.'));

            // platform info
            info.make = 'Samsung';
            info.model = localStorage.getItem('infoModel');
            info.serialNumber = localStorage.getItem('infoSerialNumber');
            info.firmwareVersion = localStorage.getItem('infoFirmware');
            info.sdkVersion = 'n/a';

            // system info
            info.operatingSystem = 'Tizen';
            info.osVersion = '';
            info.memoryPercent = 'n/a';
            info.cpuArray = 'n/a';

            // config info
            info.fan = 'n/a';
            info.signal = 'n/a';
            info.lamp = 'n/a';
            info.screen = 'n/a';
            info.temperature = 'n/a';

            // network info
            info.macAddress = localStorage.getItem('mac');
            info.dnsServers = localStorage.getItem('infoDnsservers');
            info.dhcp = localStorage.getItem('infoDhcp');
            info.ipAddress = localStorage.getItem('infoIpaddress');
            info.gateway = localStorage.getItem('infoDefaultgateway');
            info.netmask = localStorage.getItem('infoSubnetmask');
            info.wireNetwork = 'n/a';
            info.wirelessNetwork = 'n/a';

            // storage info
            info.internalTotal = 'n/a';
            info.internalFree = 'n/a';
            info.externalTotal = 'n/a';
            info.externalFree = 'n/a';
            info.internalPercentage = 'n/a';

            // picture info
            info.input = 'n/a';
            info.aspectratio = '16:9';
            info.picturemode = 'n/a';
            info.contrast = 'n/a';
            info.brightness = 'n/a';
            info.autostandby = 'n/a';

            // led, webOS only
            info.ledlayout = 'n/a';
            info.ledstatus = 'n/a';

            // screenshot
            info.screenshot = '';

            // oops screen
            info.oopsscreen = localStorage.getItem('oopsscreen');
            // logging
            info.logging = localStorage.getItem('logging');
            // app version
            info.deviceversion = localStorage.getItem('appVersion');
            // server version
            info.serverversion = localStorage.getItem('serverVersion');
            // screenshot interval
            info.screenshotinterval = localStorage.getItem('screenshotinterval');
            // last reboot
            info.lastreboot = localStorage.getItem('lastreboot');

            resolve(info);
        });
    }

    function log(name, e) {
        var message = name + ' exception [' + e.code + '] name: ' + e.name + ' message: ' + e.message;

        console.log(message);
    }

    function onScreenLog(message) {
        if (ONSCREENLOGGING) {
            ABNET.onScreenLog(message);
        }

        ABNET.debug.log(message);
    }

    return {
        NAME: NAME,
        STORE: STORE,
        init: init,
        checkIdentity: checkIdentity,
        downloadFiles: downloadFiles,
        reboot: reboot,
        restart: restart,
        getIP: getIP,
        deviceInfoToObject: deviceInfoToObject,
        screenShot: screenShot,
        process: process
    };

})();

$(document).ready(PLATFORM.init);
