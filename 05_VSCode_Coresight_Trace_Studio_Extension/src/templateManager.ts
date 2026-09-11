import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CodeInjector } from './codeInjector';

export class TemplateManager {
    private extensionContext: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.extensionContext = context;
    }

    /**
     * Finds the most likely target project directories (e.g. Core/Src and Core/Inc or workspace root).
     */
    public getProjectDirectories(workspaceRoot: string): { srcDir: string; incDir: string; mainFile: string } {
        const coreSrc = path.join(workspaceRoot, 'Core', 'Src');
        const coreInc = path.join(workspaceRoot, 'Core', 'Inc');

        let srcDir = workspaceRoot;
        let incDir = workspaceRoot;

        if (fs.existsSync(coreSrc)) {
            srcDir = coreSrc;
        } else if (fs.existsSync(path.join(workspaceRoot, 'src'))) {
            srcDir = path.join(workspaceRoot, 'src');
        }

        if (fs.existsSync(coreInc)) {
            incDir = coreInc;
        } else if (fs.existsSync(path.join(workspaceRoot, 'inc'))) {
            incDir = path.join(workspaceRoot, 'inc');
        } else if (fs.existsSync(path.join(workspaceRoot, 'include'))) {
            incDir = path.join(workspaceRoot, 'include');
        }

        const candidateMains = [
            path.join(srcDir, 'main.c'),
            path.join(workspaceRoot, 'Core', 'Src', 'main.c'),
            path.join(workspaceRoot, 'src', 'main.c'),
            path.join(workspaceRoot, 'main.c')
        ];

        let mainFile = '';
        for (const m of candidateMains) {
            if (fs.existsSync(m)) {
                mainFile = m;
                break;
            }
        }

        return { srcDir, incDir, mainFile };
    }

    /**
     * Checks if ETMv4 driver files exist in the project.
     */
    public checkDriverStatus(workspaceRoot: string): { hasC: boolean; hasH: boolean; cPath: string; hPath: string; mainHasInclude: boolean } {
        const { srcDir, incDir, mainFile } = this.getProjectDirectories(workspaceRoot);

        const cPath = path.join(srcDir, 'ETMv4.c');
        const hPath = path.join(incDir, 'ETMv4.h');

        const hasC = fs.existsSync(cPath);
        const hasH = fs.existsSync(hPath);

        let mainHasInclude = false;
        if (mainFile && fs.existsSync(mainFile)) {
            const content = fs.readFileSync(mainFile, 'utf8');
            mainHasInclude = content.includes('ETMv4.h');
        }

        return { hasC, hasH, cPath, hPath, mainHasInclude };
    }

    /**
     * Copies ETMv4.c and ETMv4.h into project and injects include into main.c.
     */
    public async addDriverFiles(workspaceRoot: string): Promise<{ success: boolean; message: string }> {
        try {
            const templatesDir = path.join(this.extensionContext.extensionPath, 'templates');
            const templateC = path.join(templatesDir, 'ETMv4.c');
            const templateH = path.join(templatesDir, 'ETMv4.h');

            if (!fs.existsSync(templateC) || !fs.existsSync(templateH)) {
                return { success: false, message: 'Extension template files (ETMv4.c / ETMv4.h) could not be found.' };
            }

            const { srcDir, incDir, mainFile } = this.getProjectDirectories(workspaceRoot);

            if (!fs.existsSync(srcDir)) {
                fs.mkdirSync(srcDir, { recursive: true });
            }
            if (!fs.existsSync(incDir)) {
                fs.mkdirSync(incDir, { recursive: true });
            }

            const destC = path.join(srcDir, 'ETMv4.c');
            const destH = path.join(incDir, 'ETMv4.h');

            fs.copyFileSync(templateC, destC);
            fs.copyFileSync(templateH, destH);

            let includeMsg = '';
            if (mainFile && fs.existsSync(mainFile)) {
                const res = await CodeInjector.injectIncludes(mainFile);
                includeMsg = ` & ${res.message}`;
            }

            return {
                success: true,
                message: `Added ETMv4.c to ${path.relative(workspaceRoot, destC)} and ETMv4.h to ${path.relative(workspaceRoot, destH)}${includeMsg}`
            };
        } catch (error: any) {
            return { success: false, message: `Failed to add driver files: ${error.message}` };
        }
    }
}
