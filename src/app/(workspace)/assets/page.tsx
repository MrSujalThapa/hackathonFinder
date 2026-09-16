import { AssetBankEditor } from "@/components/applications/AssetBankEditor";
import { listAssetBank } from "@/server/applications/repository";
export default async function AssetsPage() { const assets = await listAssetBank(); return <section className="mx-auto max-w-3xl space-y-5"><header><p className="font-mono text-xs text-muted">REUSABLE FILES & LINKS</p><h1 className="hf-doc-title text-3xl">Asset Bank</h1><p className="mt-2 text-muted">Upload a reusable document once or keep the links your applications need.</p></header><AssetBankEditor initialAssets={assets} /></section>; }
