import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import { after, it } from "node:test";

// An isolated store and fake key ensure this exercises the real composition
// without reading the developer's settings or calling a paid provider.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-exa-"));
process.env.LH_DATA_DIR = path.join(dir, "data");
process.env.LH_AUTH_FILE = path.join(dir, "auth.json");
for (const name of ["TAVILY_API_KEY", "BRAVE_API_KEY", "EXA_API_KEY"]) delete process.env[name];

const { saveKey, deleteKey, keyStatuses } = await import("../src/server/keys.ts");
const { writeSettings } = await import("../src/store/settings.ts");
const { searchStatus, searchProvider } = await import("../src/server/search.ts");
const realFetch = globalThis.fetch;

after(() => {
	globalThis.fetch = realFetch;
	delete process.env.EXA_API_KEY;
	fs.rmSync(dir, { recursive: true, force: true });
});

it("a saved Exa key activates search, and a saved pin reaches the adapter", async () => {
	const saved = saveKey("EXA_API_KEY", "exa-fake-test-key-123456");
	assert.equal(saved.ok, true);
	assert.equal(searchStatus().engine, "exa");
	assert.equal(keyStatuses().find((row) => row.id === "EXA_API_KEY")?.present, true);
	writeSettings({ version: 1, agent: { search: { engine: "exa" } } });
	assert.equal(searchStatus().engine, "exa");
	assert.match(searchStatus().reason, /chosen/);
	globalThis.fetch = async (input, init) => {
		assert.equal(String(input), "https://api.exa.ai/search");
		assert.equal((init?.headers as Record<string, string>)["x-api-key"], "exa-fake-test-key-123456");
		return new Response(JSON.stringify({ results: [{ title: "Example", url: "https://example.org", highlights: ["Evidence"] }] }));
	};
	const provider = searchProvider();
	assert.equal(provider?.id, "exa");
	assert.deepEqual(await provider!.search("evidence", 1), [{ title: "Example", url: "https://example.org", snippet: "Evidence" }]);
});

it("key rotation is live and a missing explicit Exa pin does not fall back",async()=>{
 writeSettings({version:1,agent:{search:{engine:"exa"}}});
 assert(saveKey("EXA_API_KEY","exa-rotated-fixture-key").ok);
 const seen:string[]=[];
 globalThis.fetch=async(_input,init)=>{seen.push((init?.headers as Record<string,string>)["x-api-key"]!);return Response.json({results:[]});};
 await searchProvider()!.search("fixture",1);
 assert.deepEqual(seen,["exa-rotated-fixture-key"]);
 assert(saveKey("TAVILY_API_KEY","tvly-fixture-test-key-123456").ok);
 deleteKey("EXA_API_KEY");
 assert.equal(searchStatus().available,false);assert.equal(searchProvider(),null);
 assert.match(searchStatus().reason,/EXA_API_KEY/);
 deleteKey("TAVILY_API_KEY");
});

it("restart restores the saved Exa pin and environment precedence",()=>{
 assert(saveKey("EXA_API_KEY","exa-file-fixture-key").ok);
 writeSettings({version:1,agent:{search:{engine:"exa"}}});
 const code=`
  const {searchStatus,searchProvider}=await import('./src/server/search.ts');
  let header;
  globalThis.fetch=async(_input,init)=>{header=init.headers['x-api-key'];return Response.json({results:[]});};
  await searchProvider().search('fixture',1);
  console.log(JSON.stringify({status:searchStatus(),header}));
 `;
 for(const fromEnv of [false,true]){
  const env:NodeJS.ProcessEnv={...process.env,LH_DATA_DIR:path.join(dir,"data"),LH_AUTH_FILE:path.join(dir,"auth.json"),LH_IGNORE_ENV_KEYS:"0"};
  if(fromEnv)env.EXA_API_KEY="exa-env-fixture-key";else delete env.EXA_API_KEY;
  const child=spawnSync(process.execPath,["--import","tsx","--input-type=module","--eval",code],{cwd:process.cwd(),env,encoding:"utf8",timeout:15000});
  assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout);
  assert.equal(result.status.engine,"exa");assert.match(result.status.reason,/chosen/);
  assert.equal(result.header,fromEnv?"exa-env-fixture-key":"exa-file-fixture-key");
 }
});
