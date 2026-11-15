import {AtlasError} from '../core/atlas.ts';
/** Next's internal URL may use localhost while the browser's actual Host is 127.0.0.1. */
export function requireSameOrigin(request:Request){
 const origin=request.headers.get('origin');if(!origin)return;
 try{const internal=new URL(request.url),expected=new URL(`${internal.protocol}//${request.headers.get('host')??internal.host}`).origin;if(new URL(origin).origin===expected)return;}catch{/* Malformed/multiple origins fail closed. */}
 throw new AtlasError('Cross-origin changes are refused.',403);
}
