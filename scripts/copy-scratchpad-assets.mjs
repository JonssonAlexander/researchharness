import {cpSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const destination=new URL('../public/excalidraw/fonts/',import.meta.url);
mkdirSync(destination,{recursive:true});
cpSync(fileURLToPath(new URL('../node_modules/@excalidraw/excalidraw/dist/prod/fonts/',import.meta.url)),fileURLToPath(destination),{recursive:true});

// Browser PDF reader assets must match the installed pdfjs version exactly.
const pdfDestination = new URL('../public/pdfjs/', import.meta.url);
mkdirSync(pdfDestination, {recursive:true});
for (const name of ['standard_fonts','cmaps','wasm']) cpSync(fileURLToPath(new URL(`../node_modules/pdfjs-dist/${name}/`,import.meta.url)),fileURLToPath(new URL(`${name}/`,pdfDestination)),{recursive:true});
cpSync(fileURLToPath(new URL('../node_modules/pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url)),fileURLToPath(new URL('pdf.worker.min.mjs',pdfDestination)));
