// Replacement functions for:
// resources/app.asar.unpacked/node_modules/keytar/lib/keytar.js
//
// Keep the rest of the original keytar.js unchanged.

findPassword: async function (service) {
    checkRequired(service, 'Service')

    var credentials = await module.exports.findCredentials(service)

    if (credentials.length === 0) {
        return null
    }

    return credentials[0].password
},

findCredentials: async function (service) {
    checkRequired(service, 'Service')

    var credentials = await keytar.findCredentials(service)

    // Normal Windows / working Wine implementation.
    if (credentials && credentials.length > 0) {
        return credentials
    }

    // Wine fallback:
    // In some Wine/Whisky builds, credential enumeration returns an empty
    // result even though CredWrite/CredRead work and the credential exists
    // in HKCU\Software\Wine\Credential Manager.
    if (process.platform !== 'win32') {
        return credentials || []
    }

    var childProcess = require('child_process')

    return new Promise(function (resolve) {
        childProcess.execFile(
            'reg.exe',
            [
                'query',
                'HKCU\\Software\\Wine\\Credential Manager',
                '/s'
            ],
            { windowsHide: true },
            function (error, stdout) {
                if (error || !stdout) {
                    resolve(credentials || [])
                    return
                }

                var prefix =
                    'HKEY_CURRENT_USER\\Software\\Wine\\Credential Manager\\Generic: ' +
                    service +
                    '/'

                var accounts = []

                stdout.split(/\r?\n/).forEach(function (line) {
                    line = line.trim()

                    if (line.indexOf(prefix) === 0) {
                        var account = line.slice(prefix.length)

                        if (
                            account &&
                            accounts.indexOf(account) === -1
                        ) {
                            accounts.push(account)
                        }
                    }
                })

                Promise.all(
                    accounts.map(function (account) {
                        return keytar
                            .getPassword(service, account)
                            .then(function (password) {
                                if (password === null) {
                                    return null
                                }

                                return {
                                    account: account,
                                    password: password
                                }
                            })
                            .catch(function () {
                                return null
                            })
                    })
                )
                    .then(function (results) {
                        resolve(results.filter(Boolean))
                    })
                    .catch(function () {
                        resolve(credentials || [])
                    })
            }
        )
    })
}
