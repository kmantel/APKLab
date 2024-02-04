import path = require("path");
import * as fs from "fs";
import { commands, Uri } from "vscode";
import * as yml from "js-yaml";
import { UI } from "../interface";
import { apktool } from "./apktool";
import { executeProcess } from "../utils/executor";

export namespace SplitConfig {
    export async function analyzeAllAPK(
        parentPath: string,
        apkFilePath: string,
        projectDir: string,
        args: string[],
        decompileJava: boolean,
        jadxArgs: string[],
        quarkAnalysis: boolean
    ): Promise<void> {
        const folderName = path.parse(apkFilePath).name;
        const projectRootDir = projectDir;
        projectDir = path.join(projectDir, folderName);

        const configsFile = path.join(projectRootDir, "configs.yml");
        fs.unlink(configsFile, (err) => {
            if (err) {
                console.error("Error deleting file:", err);
                return;
            }
        });
        args.splice(args.indexOf("has split-configs"), 1);
        let splitApksFilePath: string[] = [];
        let splitApksProjectDir: string[] = [];

        // make directory with app name
        fs.mkdir(projectRootDir, (err) => {
            if (err) {
                console.error("Error reading directory:", err);
                return;
            }

            // read all apk name from parent directory
            fs.readdir(parentPath, (err, files) => {
                if (err) {
                    console.error("Error reading directory:", err);
                    return;
                }
                const prefix = "split_config";

                splitApksFilePath = files
                    .filter((file) => {
                        const filePath = path.join(parentPath, file);
                        return (
                            fs.statSync(filePath).isFile() &&
                            file.startsWith(prefix)
                        );
                    })
                    .map((file) => path.join(parentPath, file));

                splitApksProjectDir = splitApksFilePath.map((file) =>
                    path.join(projectRootDir, path.parse(file).name)
                );
                const data = {
                    rootDir: projectRootDir,
                    parentPath: parentPath,
                    apkFilePath: apkFilePath,
                    args: args,
                    decompileJava: decompileJava,
                    jadxArgs: jadxArgs,
                    quarkAnalysis: quarkAnalysis,
                    apks: [
                        path.parse(apkFilePath).base,
                        ...splitApksFilePath.map(
                            (file) => path.parse(file).base
                        ),
                    ],
                    projectsDir: [projectDir, ...splitApksProjectDir],
                };
                const yamlData = yml.dump(data);

                // write as yml for future use
                fs.writeFile(configsFile, yamlData, (err) => {
                    if (err) {
                        console.error("Error writing to file:", err);
                        return;
                    }
                    console.log("Data written to file successfully.");
                });
            });
        });
        await UI.processApkFile(
            apkFilePath,
            projectDir,
            args,
            decompileJava,
            jadxArgs,
            quarkAnalysis,
            false
        );
        for (const [idx, apkPath] of splitApksFilePath.entries()) {
            await UI.processApkFile(
                apkPath,
                splitApksProjectDir[idx],
                args,
                decompileJava,
                jadxArgs,
                quarkAnalysis,
                false
            );
        }
        await commands.executeCommand(
            "vscode.openFolder",
            Uri.file(projectRootDir),
            true
        );
    }

    export async function rebuildAllApks(configYmlPath: string): Promise<void> {
        const data: any = yml.load(fs.readFileSync(configYmlPath, "utf8"));
        const distBuildFiles: string[] = [];
        const params = [];
        for (const [idx, apkDir] of data["projectsDir"].entries()) {
            const apktoolYmlPath = path.join(apkDir, "apktool.yml");
            distBuildFiles.push(path.join(apkDir, "dist", data["apks"][idx]));
            params.push(apktoolYmlPath);
        }
        const args = await UI.rebuildArgs();
        if (args)
            await Promise.all(
                params.map((param) =>apktool.rebuildAPK(param, args))
            );
        else return
        const newDistPath = path.join(path.parse(configYmlPath).dir, "dist");
        fs.mkdir(newDistPath, (err) => {
            if (err) console.log("overwriting dist folder....");
            for (const [idx, apkPath] of distBuildFiles.entries()) {
                const newPath = path.join(newDistPath, data["apks"][idx]);
                fs.rename(apkPath, newPath, (err) => {
                    if (err) {
                        console.log(err);
                        return;
                    }
                    console.log(`File moved ${data["apks"][idx]} successfully!`);
                });
            }
        });
    }

    export async function installAllApks(configYmlPath: string): Promise<void> {
        const data: any = yml.load(fs.readFileSync(configYmlPath, "utf8"));
        const distPath = path.join(path.parse(configYmlPath).dir, "dist");
        const apkFilesName = data["apks"].map((apk: string) =>
            path.join(distPath, apk)
        );
        const cmd = data.apks.join(" + ");

        const report = `Installing ${cmd}`;
        const args = ["install-multiple", "-r", ...apkFilesName];
        await executeProcess({
            name: "Installing",
            report: report,
            command: "adb",
            args: args,
        });
    }
}
