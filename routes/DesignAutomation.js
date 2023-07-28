const _path = require("path");
const _fs = require("fs");
const _url = require("url");
const express = require("express");
const http = require("https");
const formdata = require("form-data");
const bodyParser = require("body-parser");
const multer = require("multer");
const router = express.Router();
const { getClient } = require("./common/oauth");
const config = require("../config");
const dav3 = require("autodesk.forge.designautomation");
const ForgeAPI = require("forge-apis");

router.use(bodyParser.json());

// Middleware for obtaining a token for each request.
router.use(async (req, res, next) => {
    req.oauth_client = await getClient(/*config.scopes.internal*/);
    req.oauth_token = req.oauth_client.getCredentials();
    next();
});

// Static instance of the DA API
let dav3Instance = null;

class Utils {
    static async Instance() {
        if (dav3Instance === null) {
            // Here it is ok to not await since we awaited in the call router.use()
            dav3Instance = new dav3.AutodeskForgeDesignAutomationClient(
                config.client
            );
            let FetchRefresh = async (data) => {
                // data is undefined in a fetch, but contains the old credentials in a refresh
                let client = await getClient();
                let credentials = client.getCredentials();
                // The line below is for testing
                //credentials.expires_in = 30; credentials.expires_at = new Date(Date.now() + credentials.expires_in * 1000);
                return credentials;
            };
            dav3Instance.authManager.authentications["2-legged"].fetchToken =
                FetchRefresh;
            dav3Instance.authManager.authentications["2-legged"].refreshToken =
                FetchRefresh;
        }
        return dav3Instance;
    }

    /// <summary>
    /// Returns the directory where bindles are stored on the local machine.
    /// </summary>
    static get LocalBundlesFolder() {
        return _path.resolve(_path.join(__dirname, "../", "bundles"));
    }

    /// <summary>
    /// Prefix for AppBundles and Activities
    /// </summary>
    static get NickName() {
        return config.credentials.client_id;
    }

    /// <summary>
    /// Alias for the app (e.g. DEV, STG, PROD). This value may come from an environment variable
    /// </summary>
    static get Alias() {
        return "dev";
    }

    /// <summary>
    /// Search files in a folder and filter them.
    /// </summary>
    static async findFiles(dir, filter) {
        return new Promise((fulfill, reject) => {
            _fs.readdir(dir, (err, files) => {
                if (err) return reject(err);
                if (filter !== undefined && typeof filter === "string")
                    files = files.filter((file) => {
                        return _path.extname(file) === filter;
                    });
                else if (filter !== undefined && typeof filter === "object")
                    files = files.filter((file) => {
                        return filter.test(file);
                    });
                fulfill(files);
            });
        });
    }

    /// <summary>
    /// Create a new DAv3 client/API with default settings
    /// </summary>
    static async dav3API(oauth2) {
        // There is 2 alternatives to setup an API instance, providing the access_token directly
        // let apiClient2 = new dav3.AutodeskForgeDesignAutomationClient(/*config.client*/);
        // apiClient2.authManager.authentications['2-legged'].accessToken = oauth2.access_token;
        //return (new dav3.AutodeskForgeDesignAutomationApi(apiClient));

        // Or use the Auto-Refresh feature
        let apiClient = await Utils.Instance();
        return new dav3.AutodeskForgeDesignAutomationApi(apiClient);
    }

    /// <summary>
    /// Helps identify the engine
    /// </summary>
    static EngineAttributes(engine) {
        if (engine.includes("3dsMax"))
            return {
                commandLine:
                    '$(engine.path)\\3dsmaxbatch.exe -sceneFile "$(args[inputFile].path)" "$(settings[script].path)"',
                extension: "max",
                script:
                    "da = dotNetClass('Autodesk.Forge.Sample.DesignAutomation.Max.RuntimeExecute')\nda.ModifyWindowWidthHeight()\n",
            };
        if (engine.includes("AutoCAD"))
            return {
                commandLine:
                    '$(engine.path)\\accoreconsole.exe /i "$(args[inputFile].path)" /al "$(appbundles[{0}].path)" /s "$(settings[script].path)"',
                extension: "dwg",
                script: "UpdateParam\n",
            };
        if (engine.includes("Inventor"))
            return {
                commandLine:
                    '$(engine.path)\\InventorCoreConsole.exe /i "$(args[inputFile].path)" /al "$(appbundles[{0}].path)"',
                extension: "ipt",
                script: "",
            };
        if (engine.includes("Revit"))
            return {
                commandLine:
                    '$(engine.path)\\revitcoreconsole.exe /i "$(args[inputFile].path)" /al "$(appbundles[{0}].path)"',
                extension: "rvt",
                script: "",
            };

        throw new Error("Invalid engine");
    }

    static FormDataLength(form) {
        return new Promise((fulfill, reject) => {
            form.getLength((err, length) => {
                if (err) return reject(err);
                fulfill(length);
            });
        });
    }

    /// <summary>
    /// Upload a file
    /// </summary>
    static uploadFormDataWithFile(filepath, endpoint, params = null) {
        return new Promise(async (fulfill, reject) => {
            const fileStream = _fs.createReadStream(filepath);

            const form = new formdata();
            if (params) {
                const keys = Object.keys(params);
                for (let i = 0; i < keys.length; i++)
                    form.append(keys[i], params[keys[i]]);
            }
            form.append("file", fileStream);

            let headers = form.getHeaders();
            headers["Cache-Control"] = "no-cache";
            headers["Content-Length"] = await Utils.FormDataLength(form);

            const urlinfo = _url.parse(endpoint);
            const postReq = http.request(
                {
                    host: urlinfo.host,
                    port: urlinfo.port || (urlinfo.protocol === "https:" ? 443 : 80),
                    path: urlinfo.pathname,
                    method: "POST",
                    headers: headers,
                },
                (response) => {
                    fulfill(response.statusCode);
                },
                (err) => {
                    reject(err);
                }
            );

            form.pipe(postReq);
        });
    }
}