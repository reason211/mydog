#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const readline = __importStar(require("readline"));
const child_process_1 = require("child_process");
const define = __importStar(require("./util/define"));
const msgCoder = __importStar(require("./components/msgCoder"));
const program = require("commander");
const tcpClient_1 = require("./components/tcpClient");
let version = require('../package.json').version;
let DEFAULT_MASTER_HOST = '127.0.0.1';
let DEFAULT_MASTER_PORT = 3005;
let FILEREAD_ERROR = 'Fail to read the file, please check if the application is started legally.';
class clientProxy {
    constructor(host, port, token, cb) {
        this.reqId = 1;
        this.reqs = {};
        this.token = token;
        this.connect_cb = cb;
        this.socket = new tcpClient_1.TcpClient(port, host, define.some_config.SocketBufferMaxLen, true, this.connectCb.bind(this));
        this.socket.on("data", (buf) => {
            let data = JSON.parse(buf.toString());
            let reqId = data.reqId;
            let req = this.reqs[reqId];
            if (!req) {
                return;
            }
            delete this.reqs[reqId];
            clearTimeout(req.timeOut);
            req.cb(null, data.msg);
        });
        this.socket.on("close", (err) => {
            abort(err);
        });
    }
    connectCb() {
        // 注册
        let loginInfo = {
            T: 1 /* register */,
            cliToken: this.token
        };
        let loginInfo_buf = msgCoder.encodeInnerData(loginInfo);
        this.socket.send(loginInfo_buf);
        this.heartbeat();
        this.connect_cb(this);
    }
    heartbeat() {
        let self = this;
        setTimeout(function () {
            let heartBeatMsg = { T: 2 /* heartbeat */ };
            let heartBeatMsg_buf = msgCoder.encodeInnerData(heartBeatMsg);
            self.socket.send(heartBeatMsg_buf);
            self.heartbeat();
        }, define.some_config.Time.Monitor_Heart_Beat_Time * 1000);
    }
    request(msg, cb) {
        let reqId = this.reqId++;
        let data = { "T": 3 /* cliMsg */, "reqId": reqId, "msg": msg };
        let buf = msgCoder.encodeInnerData(data);
        this.socket.send(buf);
        let self = this;
        this.reqs[reqId] = {
            "cb": cb,
            "timeOut": setTimeout(function () {
                delete self.reqs[reqId];
                cb("time out");
            }, 10 * 1000)
        };
    }
    close() {
        abort();
    }
}
program.version(version);
program.command('init')
    .description('create a new application')
    .action(function () {
    init();
});
program.command('start')
    .description('start the application')
    .option('-e, --env <environment>', 'the used environment', "development")
    .option('-d, --daemon', 'enable the daemon start')
    .action(function (opts) {
    let args = [].slice.call(arguments, 0);
    opts = args[args.length - 1];
    opts.serverIds = args.slice(0, -1);
    start(opts);
});
program.command('list')
    .description('list the servers')
    .option('-h, --host <master-host>', 'master server host', DEFAULT_MASTER_HOST)
    .option('-p, --port <master-port>', 'master server port', DEFAULT_MASTER_PORT)
    .option('-t, --token <cli-token>', 'cli token', define.some_config.Cli_Token)
    .option('-i, --interval <request-interval>', 'request-interval')
    .action(function (opts) {
    list(opts);
});
program.command('stop')
    .description('stop the servers')
    .option('-h, --host <master-host>', 'master server host', DEFAULT_MASTER_HOST)
    .option('-p, --port <master-port>', 'master server port', DEFAULT_MASTER_PORT)
    .option('-t, --token <cli-token>', 'cli token', define.some_config.Cli_Token)
    .action(function (opts) {
    stop(opts);
});
program.command('remove')
    .description('remove some servers')
    .option('-h, --host <master-host>', 'master server host', DEFAULT_MASTER_HOST)
    .option('-p, --port <master-port>', 'master server port', DEFAULT_MASTER_PORT)
    .option('-t, --token <cli-token>', ' cli token', define.some_config.Cli_Token)
    .action(function (opts) {
    let args = [].slice.call(arguments, 0);
    opts = args[args.length - 1];
    opts.serverIds = args.slice(0, -1);
    remove(opts);
});
program.command('removeT')
    .description('remove some serverTypes')
    .option('-h, --host <master-host>', 'master server host', DEFAULT_MASTER_HOST)
    .option('-p, --port <master-port>', 'master server port', DEFAULT_MASTER_PORT)
    .option('-t, --token <cli-token>', ' cli token', define.some_config.Cli_Token)
    .action(function (opts) {
    let args = [].slice.call(arguments, 0);
    opts = args[args.length - 1];
    opts.serverTypes = args.slice(0, -1);
    removeT(opts);
});
program.command('cmd')
    .description('build cmd file')
    .action(function () {
    cmd();
});
program.command('*')
    .action(function () {
    console.log('Illegal command format. Use `mydog --help` to get more info.\n');
});
program.parse(process.argv);
function abort(str = "") {
    console.error(str);
    process.exit(1);
}
function init() {
    let pathStr = process.cwd();
    emptyDirectory(pathStr, function (empty) {
        if (empty) {
            process.stdin.destroy();
            createApplicationAt(pathStr);
        }
        else {
            confirm('Destination is not empty, continue? (y/n) [no] ', function (force) {
                process.stdin.destroy();
                if (force) {
                    createApplicationAt(pathStr);
                }
                else {
                    abort('Fail to init a project');
                }
            });
        }
    });
    function confirm(msg, fn) {
        prompt(msg, function (val) {
            fn(/^ *y(es)?/i.test(val));
        });
        function prompt(msg, fn) {
            if (' ' === msg[msg.length - 1]) {
                process.stdout.write(msg);
            }
            else {
                console.log(msg);
            }
            process.stdin.setEncoding('ascii');
            process.stdin.once('data', function (data) {
                fn(data.toString());
            }).resume();
        }
    }
    function createApplicationAt(ph) {
        copy(path.join(__dirname, '../template'), ph);
        function copy(origin, target) {
            if (!fs.existsSync(origin)) {
                abort(origin + 'does not exist.');
            }
            if (!fs.existsSync(target)) {
                fs.mkdirSync(target);
                console.log('   create :  ' + target);
            }
            fs.readdir(origin, function (err, datalist) {
                if (err) {
                    abort(FILEREAD_ERROR);
                }
                for (let i = 0; i < datalist.length; i++) {
                    let oCurrent = path.resolve(origin, datalist[i]);
                    let tCurrent = path.resolve(target, datalist[i]);
                    if (fs.statSync(oCurrent).isFile()) {
                        fs.writeFileSync(tCurrent, fs.readFileSync(oCurrent, ''), '');
                        console.log('   create :  ' + tCurrent);
                    }
                    else if (fs.statSync(oCurrent).isDirectory()) {
                        copy(oCurrent, tCurrent);
                    }
                }
            });
        }
    }
    function emptyDirectory(path, fn) {
        fs.readdir(path, function (err, files) {
            if (err && 'ENOENT' !== err.code) {
                abort(FILEREAD_ERROR);
            }
            fn(!files || !files.length);
        });
    }
}
function start(opts) {
    let absScript = path.resolve(process.cwd(), 'app.js');
    if (!fs.existsSync(absScript)) {
        abort("  ->  Not find the script: " + absScript);
    }
    opts.env = opts.env || "development";
    opts.daemon = !!opts.daemon;
    if (opts.serverIds.length === 0) {
        startSvr([absScript, 'env=' + opts.env, "daemon=" + opts.daemon]);
    }
    else {
        for (let one of opts.serverIds) {
            startSvr([absScript, 'env=' + opts.env, "daemon=" + opts.daemon, "id=" + one]);
        }
    }
    if (opts.daemon) {
        console.log('The application is running in the background now.\n');
        process.exit(0);
    }
    function startSvr(params) {
        let ls;
        if (opts.daemon) {
            ls = child_process_1.spawn(process.execPath, params, { detached: true, stdio: 'ignore' });
            ls.unref();
        }
        else {
            ls = child_process_1.spawn(process.execPath, params);
            ls.stdout.on('data', function (data) {
                console.log(data.toString());
            });
            ls.stderr.on('data', function (data) {
                console.log(data.toString());
            });
        }
    }
}
function list(opts) {
    let interval = Number(opts.interval) || 5;
    if (interval < 1) {
        interval = 1;
    }
    connectToMaster(opts.host, opts.port, opts.token, function (client) {
        console.log("\n");
        requestList();
        let rowNum = 0;
        function requestList() {
            client.request({ "func": "list" }, function (err, msg) {
                if (err) {
                    return abort(err);
                }
                let titles = msg.infoArr.shift();
                titles.splice(1, 1);
                let serverTypes = {};
                for (let one of msg.serverTypeSort) {
                    serverTypes[one] = [];
                }
                for (let one of msg.infoArr) {
                    serverTypes[one[1]].push(one);
                    one.splice(1, 1);
                }
                for (let x in serverTypes) {
                    serverTypes[x].sort(comparer);
                }
                let id = 1;
                titles.unshift("");
                let endArr = [];
                endArr.push(titles);
                serverTypes["master"][0].unshift(" " + id.toString());
                id++;
                endArr.push(serverTypes["master"][0]);
                delete serverTypes["master"];
                for (let x in serverTypes) {
                    for (let one of serverTypes[x]) {
                        one.unshift(" " + id.toString());
                        id++;
                        endArr.push(one);
                    }
                }
                readline.cursorTo(process.stdout, 0);
                readline.moveCursor(process.stdout, 0, -rowNum);
                readline.clearScreenDown(process.stdout);
                rowNum = endArr.length + 1;
                mydogListPrint(msg.name, msg.env, endArr);
                setTimeout(requestList, interval * 1000);
            });
        }
    });
    let comparer = function (a, b) {
        if (a[0] < b[0]) {
            return -1;
        }
        else {
            return 1;
        }
    };
    function mydogListPrint(appName, env, infoArr) {
        let consoleMaxColumns = process.stdout.columns - 2;
        let nameEnv = "  appName: " + appName + "    env: " + env;
        console.log("\x1b[35m" + getRealStr(nameEnv) + "\x1b[0m");
        let widthArr = []; // 每个字段的控制台宽度
        let columnWidth = []; // 每列的最大宽度
        let titleLen = infoArr[0].length;
        for (let i = 0; i < titleLen; i++) {
            columnWidth.push(0);
        }
        for (let i = 0; i < infoArr.length; i++) {
            let one = infoArr[i];
            if (one.length > titleLen) {
                one.splice(titleLen);
            }
            else if (one.length < titleLen) {
                for (let j = titleLen - one.length - 1; j >= 0; j--) {
                    one.push("");
                }
            }
            let tmpArr = [];
            for (let j = 0; j < titleLen; j++) {
                one[j] = one[j].toString();
                let tmpLen = getDisplayLength(one[j]);
                tmpArr.push(tmpLen);
                if (tmpLen > columnWidth[j]) {
                    columnWidth[j] = tmpLen;
                }
            }
            widthArr[i] = tmpArr;
        }
        for (let i = 0; i < titleLen; i++) {
            columnWidth[i] += 3;
        }
        for (let i = 0; i < infoArr.length; i++) {
            let one = infoArr[i];
            let tmpWidthArr = widthArr[i];
            for (let j = 0; j < titleLen; j++) {
                one[j] += " ".repeat(columnWidth[j] - tmpWidthArr[j]);
            }
            if (i === 0) {
                console.log("\x1b[31m" + getRealStr(one.join("")) + "\x1b[0m");
            }
            else {
                console.log(getRealStr(one.join("")));
            }
        }
        function getRealStr(str) {
            while (getDisplayLength(str) > consoleMaxColumns) {
                str = str.substring(0, str.length - 2);
            }
            return str;
        }
        //获得字符串实际长度，中文2，英文1
        //控制台中中文占用2个英文字符的宽度
        function getDisplayLength(str) {
            let realLength = 0, len = str.length, charCode = -1;
            for (var i = 0; i < len; i++) {
                charCode = str.charCodeAt(i);
                if (charCode >= 0 && charCode <= 128) {
                    realLength += 1;
                }
                else {
                    realLength += 2;
                }
            }
            return realLength;
        }
    }
}
function stop(opts) {
    connectToMaster(opts.host, opts.port, opts.token, function (client) {
        client.request({ "func": "stop" }, function (err) {
            if (err) {
                return abort(err);
            }
            abort("the application has stopped, please confirm!");
        });
    });
}
function remove(opts) {
    if (opts.serverIds.length === 0) {
        return abort("no server input, please use `mydog remove server-id-1 server-id-2` ");
    }
    connectToMaster(opts.host, opts.port, opts.token, function (client) {
        client.request({ "func": "remove", "args": opts.serverIds }, function (err) {
            if (err) {
                return abort(err);
            }
            abort("the servers have been removed, please confirm!");
        });
    });
}
function removeT(opts) {
    if (opts.serverTypes.length === 0) {
        return abort("no serverType input, please use `mydog removeT gate connector` ");
    }
    connectToMaster(opts.host, opts.port, opts.token, function (client) {
        client.request({ "func": "removeT", "args": opts.serverTypes }, function (err) {
            if (err) {
                return abort(err);
            }
            abort("the serverTypes have been removed, please confirm!");
        });
    });
}
function cmd() {
    let routePath = "config/sys/route.ts";
    let serverPath = "config/cmd.ts";
    let clientPathCs = "config/CmdClient.cs";
    let clientPathTs = "config/cmdClient.ts";
    let nowPath = process.cwd();
    let filepath = path.join(nowPath, routePath);
    if (!fs.existsSync(filepath)) {
        abort("  ->  Not find the script: " + filepath);
    }
    let readStream = fs.createReadStream(filepath);
    let read_l = readline.createInterface({ "input": readStream });
    let hasStart = false;
    let cmdObjArr = [];
    read_l.on("line", function (line) {
        line = line.trim();
        if (line === "") {
            return;
        }
        if (!hasStart) {
            if (line.indexOf("export") === 0)
                hasStart = true;
            return;
        }
        if (line.indexOf("]") === 0) {
            serverCmd();
            clientCmd();
            read_l.close();
            return;
        }
        if (line.indexOf('"') !== 0) {
            return;
        }
        line = line.substring(1);
        let index = line.indexOf('"');
        if (index === -1) {
            return;
        }
        let cmd = line.substring(0, index);
        let note = "";
        index = line.indexOf("//");
        if (index !== -1) {
            note = line.substring(index + 2).trim();
        }
        cmdObjArr.push({ "cmd": cmd, "note": note });
    });
    read_l.on("close", function () {
        console.log("build cmd ok!");
    });
    function serverCmd() {
        let endStr = `export const enum cmd {\n`;
        let index = 0;
        for (let one of cmdObjArr) {
            if (one.note) {
                endStr += `\t/**\n\t * ${one.note}\n\t */\n`;
            }
            let oneStr = one.cmd;
            if (one.cmd.indexOf('.') !== -1) {
                let tmpArr = one.cmd.split('.');
                oneStr = tmpArr[0] + '_' + tmpArr[1] + '_' + tmpArr[2];
            }
            endStr += `\t${oneStr} = ${index},\n`;
            index++;
        }
        endStr += '}';
        let csFilename = path.join(nowPath, serverPath);
        fs.writeFileSync(csFilename, endStr);
    }
    function clientCmd() {
        let endStrCs = 'public class Cmd\n{\n';
        let endStrTs = 'export const enum cmd {\n';
        for (let one of cmdObjArr) {
            if (one.note) {
                endStrCs += `\t/// <summary>\n\t/// ${one.note}\n\t/// </summary>\n`;
                endStrTs += `\t/**\n\t * ${one.note}\n\t */\n`;
            }
            let oneStr = one.cmd;
            if (one.cmd.indexOf('.') !== -1) {
                let tmpArr = one.cmd.split('.');
                oneStr = tmpArr[0] + '_' + tmpArr[1] + '_' + tmpArr[2];
            }
            endStrCs += `\tpublic const string ${oneStr} = "${one.cmd}";\n`;
            endStrTs += `\t${oneStr} = "${one.cmd}",\n`;
        }
        endStrCs += '}';
        endStrTs += '}';
        fs.writeFileSync(path.join(nowPath, clientPathCs), endStrCs);
        fs.writeFileSync(path.join(nowPath, clientPathTs), endStrTs);
    }
}
function connectToMaster(host, port, token, cb) {
    console.log("try to connect  " + host + ":" + port);
    let client = new clientProxy(host, port, token, cb);
}