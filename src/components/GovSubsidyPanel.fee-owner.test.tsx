// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { SectionPanelProps, FeePublicViewV1 } from "@wedly/ui-shared";
import { createGovSubsidyPanel, type GovSubsidyPanelConfig } from "./GovSubsidyPanel";
import type { TierFieldEditIntentV1 } from "./tier-field-edit-intent";

const child = vi.hoisted(() => ({ props: null as null | { rawValue: string; onSave: (json: string, intent?: TierFieldEditIntentV1) => void } }));
vi.mock("./SettlementInfoTab", () => ({ default: (props: typeof child.props) => { child.props = props; return <div />; } }));
const requestId = "30000000-0000-4000-8000-000000000001";
type Row = SectionPanelProps["rows"][number] & { feeView?: FeePublicViewV1 };
function owner(entryId: string, idless = false): Row {
 return { domain: "government-subsidy", entryId, domainLabel: "정부지원금", row: { 계약정보_차수: JSON.stringify([{ ...(idless ? {} : { id: "same" }), 계약금: 100 }]) }, feeView: { version: 1, mode: "standard", owner: { sourceTable: "PolicyFundEntry", entryId }, targets: [{ scope: "gov-contract", target: { area: "contract", containerKey: "계약정보_차수", tierId: idless ? "tier-1-0" : "same" }, status: "blocked", reason: "fee-base-vat-basis-unconfirmed", fields: {}, edits: { 계약금: { status: "ready", eventVersion: "current-generation" } } }] } } as Row;
}
let host: HTMLDivElement, root: Root, save: ReturnType<typeof vi.fn>;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({success:true,data:[]})}))); host=document.createElement("div"); document.body.append(host); root=createRoot(host); save=vi.fn(async () => undefined); child.props=null; });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(rows: Row[], editable=true) {
 const config: GovSubsidyPanelConfig = { editable, allowStructureEdit:false, ownSource:"illua", commentsPath:id=>`/comments/${id}`, contractFieldsPath:"/contract", settlementFieldsPath:"/settlement", refundFieldsPath:"/refund", configPath:"/config", savePolicyField:save, filterPolicyRows:rows=>rows };
 const Panel=createGovSubsidyPanel(config);
 const adapter={ api:{ currentUser:async()=>({name:"검사"}) }, components:{ MeetingsTab:()=>null } } as unknown as SectionPanelProps["adapter"];
 await act(async()=> { root.render(<Panel rows={rows} primaryRow={{}} isAdmin adapter={adapter} onSubTabChange={()=>{}} />); });
 const tab=[...host.querySelectorAll("button")].find(b=>b.textContent==="계약정보"); expect(tab).toBeTruthy();
 await act(async()=>tab!.click());
 expect(child.props).not.toBeNull();
}
async function edit(tierId:string, previous:TierFieldEditIntentV1["previous"]={present:true,value:100}, value=200) {
 const tiers=JSON.parse(child.props!.rawValue) as Record<string,unknown>[];
 if(tiers.length) tiers[0].계약금=value; else tiers.push({id:tierId,계약금:value});
 await act(async()=>{ child.props!.onSave(JSON.stringify(tiers),{version:1,requestId,kind:"field",tierId,fieldKey:"계약금",previous}); await new Promise(resolve=>setTimeout(resolve,5)); });
}
it.each([false,true])("selecting the second contract writes only that owner, idless=%s",async idless=>{
 await render([owner("first"),owner("second",idless)]);
 const button=[...host.querySelectorAll("button")].find(b=>b.textContent==="계약 2"); expect(button).toBeTruthy();
 await act(async()=>button!.click());
 await edit(idless?"gm0~noid0":"gm0~same");
 expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0][0]).toBe("second");
 expect(save.mock.calls[0][3]).toMatchObject({feeEdit:{selection:{entryId:"second",tierId:idless?"tier-1-0":"same"},expectedEventVersion:"current-generation"}});
});
it("a read-only Illua panel never sends a save even with an edit intent",async()=>{ await render([owner("first")],false); await edit("gm0~same"); expect(save).not.toHaveBeenCalled(); });
it("a standard first draft binds the selected owner with an absent event precondition",async()=>{
 const row=owner("first"); row.row.계약정보_차수="[]"; row.feeView={version:1,mode:"standard",owner:{sourceTable:"PolicyFundEntry",entryId:"first"},targets:[]};
 await render([row]); await edit("draft-new",{present:false});
 expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0][3]).toMatchObject({feeEdit:{selection:{entryId:"first",tierId:"draft-new"},previous:{present:false},expectedEventVersion:null}});
});
