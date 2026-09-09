/* Projeção da ficha que a recepção pode ler. Nenhum texto clínico é copiado. */
const CAMPOS = ['id', 'nome', 'nomeSocial', 'nasc', 'sexo', 'cpf', 'fone', 'email', 'endereco', 'nomeMae', 'naturalidade', 'convenioId', 'convenioNumero', 'origem', 'consentimentos', 'ativo', 'inativadoEm', 'createdAt', 'updatedAt'];
function cadastro(p) {
  const out = {};
  for (const key of CAMPOS) if (p[key] !== undefined) out[key] = p[key];
  return out;
}
module.exports = { cadastro, CAMPOS };
