import { QuestionBankEditor } from "@/components/applications/QuestionBankEditor";
import { listQuestionBank, listQuestionBankFolders } from "@/server/applications/repository";
export default async function QuestionsPage() { const [entries, folders] = await Promise.all([listQuestionBank(), listQuestionBankFolders()]); return <section className="mx-auto max-w-4xl space-y-5"><header><p className="font-mono text-xs text-muted">REUSABLE ANSWERS</p><h1 className="hf-doc-title text-3xl">Question Bank</h1></header><QuestionBankEditor initialEntries={entries} initialFolders={folders} /></section>; }
