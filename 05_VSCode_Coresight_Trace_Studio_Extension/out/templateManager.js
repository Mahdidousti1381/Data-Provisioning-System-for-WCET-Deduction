"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TemplateManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const codeInjector_1 = require("./codeInjector");
class TemplateManager {
    extensionContext;
    constructor(context) {
        this.extensionContext = context;
    }
    /**
     * Finds the most likely target project directories (e.g. Core/Src and Core/Inc or workspace root).
     */
    getProjectDirectories(workspaceRoot) {
        const coreSrc = path.join(workspaceRoot, 'Core', 'Src');
        const coreInc = path.join(workspaceRoot, 'Core', 'Inc');
        let srcDir = workspaceRoot;
        let incDir = workspaceRoot;
        if (fs.existsSync(coreSrc)) {
            srcDir = coreSrc;
        }
        else if (fs.existsSync(path.join(workspaceRoot, 'src'))) {
            srcDir = path.join(workspaceRoot, 'src');
        }
        if (fs.existsSync(coreInc)) {
            incDir = coreInc;
        }
        else if (fs.existsSync(path.join(workspaceRoot, 'inc'))) {
            incDir = path.join(workspaceRoot, 'inc');
        }
        else if (fs.existsSync(path.join(workspaceRoot, 'include'))) {
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
    checkDriverStatus(workspaceRoot) {
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
    async addDriverFiles(workspaceRoot) {
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
                const res = await codeInjector_1.CodeInjector.injectIncludes(mainFile);
                includeMsg = ` & ${res.message}`;
            }
            return {
                success: true,
                message: `Added ETMv4.c to ${path.relative(workspaceRoot, destC)} and ETMv4.h to ${path.relative(workspaceRoot, destH)}${includeMsg}`
            };
        }
        catch (error) {
            return { success: false, message: `Failed to add driver files: ${error.message}` };
        }
    }
}
exports.TemplateManager = TemplateManager;
//# sourceMappingURL=templateManager.js.map