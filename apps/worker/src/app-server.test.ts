import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexAppServer } from "./app-server.js";
test("App Server buffers early notifications, reconstructs missing threads and bounds RPCs", async () => {
  const root = await mkdtemp(join(tmpdir(), "skilled-protocol-"));
  const original = process.env.CODEX_BIN;
  const script = join(root, "protocol");
  await writeFile(
    script,
    `#!${process.execPath}
const {createInterface}=require('node:readline');
const send=(value)=>process.stdout.write(JSON.stringify(value)+'\\n');
createInterface({input:process.stdin}).on('line',line=>{ const r=JSON.parse(line); if(!r.id)return;
if(r.method==='ignore') return;
if(r.method==='initialize')return send({id:r.id,result:{}});
if(r.method==='thread/resume')return send({id:r.id,error:{message:'Thread not found'}});
if(r.method==='thread/start')return send({id:r.id,result:{thread:{id:'replacement-thread'}}});
if(r.method==='turn/start') {
send({method:'item/agentMessage/delta',params:{threadId:'replacement-thread',turnId:'turn-fixture',itemId:'message',delta:'early evidence'}});
send({method:'turn/completed',params:{threadId:'replacement-thread',turn:{id:'turn-fixture',status:'completed',error:null,items:[{type:'agentMessage',text:'{"reply":"fixture"}',id:'message'}]}}});
return send({id:r.id,result:{turn:{id:'turn-fixture',items:[]}}}); }
send({id:r.id,result:{}});
});`,
    { mode: 0o755 },
  );
  process.env.CODEX_BIN = script;
  const client = new CodexAppServer({ rpc: 1000, turn: 1000 });
  try {
    const chunks: string[] = [];
    const result = await client.structuredTurn(
      root,
      "Synthetic prompt",
      {},
      "missing-thread",
      {
        recoveryContext: "Completed synthetic conversation",
        onDelta: (text) => {
          chunks.push(text);
        },
      },
    );
    assert.equal(result.reconstructed, true);
    assert.deepEqual(result.structured, { reply: "fixture" });
    assert.ok(chunks.join("").endsWith("early evidence"));
    await assert.rejects(client.request("ignore", {}), /timed out/);
  } finally {
    await client.stop();
    if (original === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = original;
    await rm(root, { recursive: true, force: true });
  }
});
test("App Server spawn failures reject pending initialization", async () => {
  const prior = process.env.CODEX_BIN;
  process.env.CODEX_BIN = "/nonexistent/skilled-test-codex";
  const client = new CodexAppServer({ rpc: 1000, turn: 1000 });
  try {
    await assert.rejects(client.start(), /exited|unavailable/);
  } finally {
    await client.stop();
    if (prior === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = prior;
  }
});
