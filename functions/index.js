/* ============================================================================
   Clinicar — functions/index.js
   Funções de IA (Gemini via Vertex AI) SEM chave de API: a função se autentica
   com a própria conta de serviço do projeto (token do metadata server).
   Só usuários autenticados (Firebase Auth) chamam; o app chama por httpsCallable
   ('gemini' e 'geminiAudio', região southamerica-east1) — ver src/backend.js.

   Como publicar (4 passos, feitos pelo dono do projeto):
   1. No console do Google Cloud do MESMO projeto Firebase, habilite a "Vertex AI API"
      (aiplatform.googleapis.com). O plano do projeto precisa ser Blaze.
   2. Na raiz do repositório: `firebase login`, `firebase use <id-do-projeto>` e
      `firebase deploy --only functions,firestore:rules` (usa firebase.json + firestore.rules).
      Se o deploy criar a função sem permissão de invocação, apague-a e publique de novo
      (as callables abaixo já pedem invoker público; a autenticação é feita no código).
   3. Cole a configuração web do projeto em src/config.js (apiKey, projectId, appId…).
   4. Abra o Clinicar, entre com e-mail/senha criados no console (Authentication) e teste
      "Estruturar com IA" numa evolução fictícia. Sem função publicada, o app mostra
      "Configure o backend" e continua funcionando sem IA.
   ============================================================================ */
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const PROJECT = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.PROJECT_ID || "";
const LOCATION = process.env.VERTEX_LOCATION || "global";     // endpoint global atende os modelos Gemini 2.5
const REGIAO = "southamerica-east1";
const MAX_PROMPT = 24000;          // caracteres
const MAX_AUDIO_B64 = 9500000;     // ~9,5 MB de base64 (~7 MB de áudio)
const MODELO_OK = /^gemini-2\.5-(flash|pro)(-[a-z0-9-]+)?$/;
const MODELO_PADRAO = "gemini-2.5-flash";

/* ---- token da própria conta de serviço (metadata server) ---- */
async function accessToken() {
  const r = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } }
  );
  if (!r.ok) throw new Error("Não foi possível obter o token da conta de serviço.");
  const j = await r.json();
  if (!j.access_token) throw new Error("Token da conta de serviço vazio.");
  return j.access_token;
}

/* ---- chamada à Vertex AI (Gemini) ---- */
async function chamarVertex(contents, model, generationConfig, systemInstruction) {
  if (!PROJECT) throw new Error("Projeto não identificado no ambiente da função.");
  const token = await accessToken();
  const url = `https://aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${model}:generateContent`;
  const corpo = { contents };
  if (generationConfig && typeof generationConfig === "object") corpo.generationConfig = generationConfig;
  if (systemInstruction) corpo.systemInstruction = { parts: [{ text: String(systemInstruction) }] };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(corpo)
  });
  if (!r.ok) {
    const t = await r.text();
    const err = new Error("Falha na IA (" + r.status + "). " + t.slice(0, 220));
    err.httpStatus = r.status;
    throw err;
  }
  const data = await r.json();
  let text = "";
  try {
    text = (data.candidates[0].content.parts || []).map((p) => (p && p.text) ? p.text : "").join("");
  } catch (e) { text = ""; }
  if (!text) throw new Error("A IA não retornou texto.");
  return text;
}

function exigirLogin(req) {
  if (!req.auth || !req.auth.uid) throw new HttpsError("unauthenticated", "Entre na sua conta para usar a IA.");
}
function modeloDe(v) {
  const m = String(v || MODELO_PADRAO);
  if (!MODELO_OK.test(m)) throw new HttpsError("invalid-argument", "Modelo não permitido.");
  return m;
}
function traduzir(e) {
  if (e instanceof HttpsError) return e;
  const msg = (e && e.message) || "Falha na IA.";
  if (e && e.httpStatus === 403) return new HttpsError("permission-denied", "A Vertex AI API não está habilitada ou a conta de serviço não tem permissão. " + msg);
  if (e && e.httpStatus === 404) return new HttpsError("not-found", "Modelo ou endpoint não encontrado. " + msg);
  if (e && e.httpStatus === 429) return new HttpsError("resource-exhausted", "Limite de uso da IA atingido. Tente de novo em instantes.");
  return new HttpsError("internal", msg);
}

const SISTEMA = "Você é um assistente clínico que apoia profissionais de saúde no Brasil. Responda em português do Brasil, com objetividade. Não invente dados que não estejam no texto ou no áudio recebido; marque lacunas como [não informado]. O profissional revisa tudo antes de salvar.";

/* ============== gemini: texto → texto ============== */
exports.gemini = onCall({ region: REGIAO, timeoutSeconds: 120, memory: "256MiB", invoker: "public" }, async (req) => {
  exigirLogin(req);
  const d = req.data || {};
  const prompt = String(d.prompt || "");
  const model = modeloDe(d.model);
  if (!prompt.trim()) throw new HttpsError("invalid-argument", "Texto vazio.");
  if (prompt.length > MAX_PROMPT) throw new HttpsError("invalid-argument", "Texto muito longo (máximo de 24.000 caracteres).");
  const generationConfig = { temperature: 0.3, maxOutputTokens: 8192 };
  try {
    const text = await chamarVertex([{ role: "user", parts: [{ text: prompt }] }], model, generationConfig, SISTEMA);
    return { text };
  } catch (e) {
    throw traduzir(e);
  }
});

/* ============== geminiAudio: áudio (base64) + instrução → texto ============== */
exports.geminiAudio = onCall({ region: REGIAO, timeoutSeconds: 300, memory: "512MiB", invoker: "public" }, async (req) => {
  exigirLogin(req);
  const d = req.data || {};
  const audio = String(d.audio || "");
  const mimeType = String(d.mimeType || "audio/webm");
  const prompt = String(d.prompt || "Transcreva e organize o conteúdo deste áudio.");
  const model = modeloDe(d.model);
  if (!audio) throw new HttpsError("invalid-argument", "Áudio vazio.");
  if (audio.length > MAX_AUDIO_B64) throw new HttpsError("invalid-argument", "Áudio muito longo — grave em blocos menores (até ~25 min).");
  if (!/^audio\/[a-z0-9.+-]+$/i.test(mimeType)) throw new HttpsError("invalid-argument", "Tipo de áudio inválido.");
  if (prompt.length > MAX_PROMPT) throw new HttpsError("invalid-argument", "Instrução muito longa.");
  const contents = [{ role: "user", parts: [{ inlineData: { mimeType, data: audio } }, { text: prompt }] }];
  const generationConfig = { temperature: 0.2, maxOutputTokens: 8192 };
  try {
    const text = await chamarVertex(contents, model, generationConfig, SISTEMA);
    return { text };
  } catch (e) {
    throw traduzir(e);
  }
});
