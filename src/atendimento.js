/* Clinicar — atendimento.js (dono: atendimento)
   Global único: Atendimento. Tela de atendimento (#/atendimento/<consultaId>), evolução (livre/SOAP/
   anamnese/alta/encaminhamento) com rascunho autosalvo, ditado (Web Speech) e gravação da consulta →
   IA (Backend.ai), receituário com banco de medicamentos e separação simples/antimicrobiano/controle,
   atestado (CID só com autorização), pedido de exames, documentos por modelo, exames laboratoriais com
   curva SVG, impressão A4 com prévia (CL.print) e as abas clínicas da ficha (Atendimento.abrirAba).
   Contrato: docs/ESPEC.md §4.9 e §5.3. Escrita no estado SÓ por CL.upsert / CL.patch / CL.remove. */
(function () {
  'use strict';
  var e = function (s) { return CL.util.esc(s); };

  /* =================== constantes clínicas =================== */
  var REC_FMT = {
    evolucao: { l: 'Evolução', ai: 'Organize o texto em uma evolução médica clara, concisa e profissional, mantendo apenas as informações fornecidas.' },
    soap: { l: 'SOAP', ai: 'Organize em evolução médica no formato SOAP — S (Subjetivo), O (Objetivo: exame físico, sinais vitais, exames), A (Avaliação / impressão diagnóstica), P (Plano / conduta).' },
    anamnese: { l: 'Anamnese', ai: 'Produza uma anamnese clínica com as seções: Identificação, Queixa principal, História da doença atual (HDA), Antecedentes pessoais, Antecedentes familiares, Hábitos de vida, Medicações em uso, Alergias, Exame físico, Hipóteses diagnósticas e Conduta. REGRAS DE CONTEÚDO: (1) a HDA deve ser TEXTO CORRIDO (nunca em tópicos), narrando os sintomas de forma CRONOLÓGICA e conectada — início, fatores desencadeantes, progressão, sintomas associados, tratamentos e resposta — numa narrativa coerente; (2) em Antecedentes pessoais registre os DIAGNÓSTICOS médicos padronizados, não a fala literal do paciente (ex.: "pressão alta" → HAS; "colesterol alto" → dislipidemia; "diabetes" → DM2); (3) em Medicações em uso liste APENAS os nomes dos medicamentos (separados por vírgula), SEM a indicação de cada um; (4) a Conduta deve ser COMPLETA e adequada a TODAS as patologias do paciente — para cada problema ativo inclua exames/seguimento/ajuste terapêutico pertinentes e medidas gerais, não só o motivo da consulta.' },
    alta: { l: 'Alta', ai: 'Organize em resumo de alta: Diagnósticos, Resumo do atendimento, Procedimentos, Medicações de alta, Orientações e Seguimento.' },
    encaminhamento: { l: 'Encaminhamento', ai: 'Organize em carta de encaminhamento/parecer: especialidade de destino, resumo do caso, hipótese diagnóstica, exames relevantes e motivo do encaminhamento.' }
  };
  var ATEND_TIPOS = { primeira: 'Primeira consulta', retorno: 'Retorno', nova: 'Nova consulta' };
  var PROMPT_BASE = 'Você é um escriba clínico experiente. O texto abaixo pode ser a TRANSCRIÇÃO de uma consulta inteira (fala do profissional e do paciente, linguagem coloquial, com repetições e possíveis ruídos) ou um rascunho/ditado. Extraia apenas as informações clinicamente relevantes e produza um documento em português do Brasil, completo, organizado e objetivo. REGRAS: não invente dados, exames, doses ou condutas que não foram ditos; ignore conversas irrelevantes; padronize termos médicos; se algo essencial faltar, escreva "[não informado]". FORMATAÇÃO: escreva em texto limpo e profissional, SEM markdown — não use #, nem asteriscos, nem negrito; escreva o nome de cada seção seguido de dois-pontos e, quando precisar listar, use um único hífen no início da linha.';
  var PROMPT_AUDIO = 'Você recebeu o ÁUDIO de uma consulta (fala do profissional e do paciente). Transcreva internamente e produza um documento clínico em português do Brasil, completo, organizado e objetivo, extraindo só o que é clinicamente relevante. REGRAS: não invente dados, exames, doses ou condutas que não foram ditos; padronize termos médicos; se algo essencial faltar, escreva "[não informado]". FORMATAÇÃO: escreva em texto limpo e profissional, SEM markdown — não use #, nem asteriscos, nem negrito; escreva o nome de cada seção seguido de dois-pontos e, quando precisar listar, use um único hífen no início da linha.';

  /* Banco de medicamentos: nome + apresentação e posologia padrão (adulto). c:1 = controle especial.
     Posologia é sugestão — ajustar por caso. Reaproveitado do sistema anterior. */
  var MED_DB = [
   // Analgésicos / antitérmicos / AINEs
   {n:'Dipirona 1g comprimido',p:'1 comprimido via oral de 6/6h se dor ou febre (máx. 4g/dia) — por 3 dias'},
   {n:'Dipirona 500mg/mL solução oral (gotas)',p:'20 a 40 gotas via oral de 6/6h se dor ou febre'},
   {n:'Paracetamol 750mg comprimido',p:'1 comprimido via oral de 6/6h se dor ou febre (máx. 4g/dia)'},
   {n:'Ibuprofeno 600mg comprimido',p:'1 comprimido via oral de 8/8h após as refeições — por 3 a 5 dias'},
   {n:'Naproxeno 500mg comprimido',p:'1 comprimido via oral de 12/12h após as refeições — por 5 dias'},
   {n:'Nimesulida 100mg comprimido',p:'1 comprimido via oral de 12/12h após as refeições — por 5 dias'},
   {n:'Diclofenaco sódico 50mg comprimido',p:'1 comprimido via oral de 8/8h após as refeições — por 3 a 5 dias'},
   {n:'Cetoprofeno 100mg comprimido',p:'1 comprimido via oral de 12/12h após as refeições — por 3 dias'},
   {n:'Cetorolaco 10mg comprimido',p:'1 comprimido via oral de 8/8h se dor (máx. 5 dias)'},
   {n:'Tramadol 50mg cápsula',p:'1 cápsula via oral de 8/8h se dor intensa',c:1},
   {n:'Codeína 30mg + Paracetamol 500mg comprimido',p:'1 comprimido via oral de 6/6h se dor moderada',c:1},
   {n:'Ciclobenzaprina 5mg comprimido',p:'1 comprimido via oral à noite — por 7 dias'},
   {n:'Escopolamina + dipirona (Buscopan composto) comprimido',p:'1 comprimido via oral de 6/6h se cólica'},
   {n:'Butilbrometo de escopolamina 10mg comprimido',p:'1 comprimido via oral de 8/8h se cólica'},
   // Antibióticos / antimicrobianos
   {n:'Amoxicilina 500mg cápsula',p:'1 cápsula via oral de 8/8h — por 7 dias'},
   {n:'Amoxicilina + Clavulanato 875+125mg comprimido',p:'1 comprimido via oral de 12/12h — por 7 dias'},
   {n:'Azitromicina 500mg comprimido',p:'1 comprimido via oral 1x/dia — por 3 a 5 dias'},
   {n:'Cefalexina 500mg cápsula',p:'1 cápsula via oral de 6/6h — por 7 dias'},
   {n:'Cefuroxima 500mg comprimido',p:'1 comprimido via oral de 12/12h — por 7 dias'},
   {n:'Ciprofloxacino 500mg comprimido',p:'1 comprimido via oral de 12/12h — por 7 dias'},
   {n:'Levofloxacino 500mg comprimido',p:'1 comprimido via oral 1x/dia — por 7 dias'},
   {n:'Sulfametoxazol + Trimetoprima 800+160mg comprimido',p:'1 comprimido via oral de 12/12h — por 7 dias'},
   {n:'Doxiciclina 100mg comprimido',p:'1 comprimido via oral de 12/12h — por 7 dias'},
   {n:'Metronidazol 400mg comprimido',p:'1 comprimido via oral de 8/8h — por 7 dias'},
   {n:'Nitrofurantoína 100mg cápsula',p:'1 cápsula via oral de 6/6h — por 5 a 7 dias'},
   {n:'Fosfomicina trometamol 3g sachê',p:'1 sachê via oral em dose única, à noite, com a bexiga vazia'},
   {n:'Claritromicina 500mg comprimido',p:'1 comprimido via oral de 12/12h — por 7 dias'},
   {n:'Clindamicina 300mg cápsula',p:'1 cápsula via oral de 8/8h — por 7 dias'},
   {n:'Penicilina G benzatina 1.200.000 UI',p:'aplicar 1.200.000 UI por via intramuscular em dose única'},
   {n:'Aciclovir 400mg comprimido',p:'1 comprimido via oral de 8/8h — por 7 dias'},
   {n:'Fluconazol 150mg cápsula',p:'1 cápsula via oral em dose única'},
   {n:'Nistatina 100.000 UI/mL suspensão oral',p:'bochechar e engolir 5 mL de 6/6h — por 14 dias'},
   {n:'Ivermectina 6mg comprimido',p:'conforme peso (200 mcg/kg) via oral em dose única, repetir em 7 dias'},
   {n:'Albendazol 400mg comprimido',p:'1 comprimido via oral em dose única'},
   {n:'Mebendazol 100mg comprimido',p:'1 comprimido via oral de 12/12h — por 3 dias'},
   // Anti-hipertensivos / cardiovascular
   {n:'Losartana 50mg comprimido',p:'1 comprimido via oral 1x/dia (pode 12/12h)'},
   {n:'Valsartana 160mg comprimido',p:'1 comprimido via oral 1x/dia'},
   {n:'Enalapril 10mg comprimido',p:'1 comprimido via oral de 12/12h'},
   {n:'Captopril 25mg comprimido',p:'1 comprimido via oral de 8/8h'},
   {n:'Ramipril 5mg comprimido',p:'1 comprimido via oral 1x/dia'},
   {n:'Anlodipino 5mg comprimido',p:'1 comprimido via oral 1x/dia'},
   {n:'Nifedipino retard 20mg comprimido',p:'1 comprimido via oral de 12/12h'},
   {n:'Hidroclorotiazida 25mg comprimido',p:'1 comprimido via oral pela manhã'},
   {n:'Clortalidona 25mg comprimido',p:'1 comprimido via oral pela manhã'},
   {n:'Furosemida 40mg comprimido',p:'1 comprimido via oral pela manhã'},
   {n:'Espironolactona 25mg comprimido',p:'1 comprimido via oral 1x/dia'},
   {n:'Atenolol 50mg comprimido',p:'1 comprimido via oral 1x/dia'},
   {n:'Metoprolol succinato 50mg comprimido',p:'1 comprimido via oral 1x/dia'},
   {n:'Carvedilol 6,25mg comprimido',p:'1 comprimido via oral de 12/12h'},
   {n:'Propranolol 40mg comprimido',p:'1 comprimido via oral de 12/12h'},
   {n:'Metildopa 250mg comprimido',p:'1 comprimido via oral de 8/8h'},
   {n:'Sinvastatina 20mg comprimido',p:'1 comprimido via oral à noite'},
   {n:'Atorvastatina 20mg comprimido',p:'1 comprimido via oral 1x/dia'},
   {n:'Rosuvastatina 10mg comprimido',p:'1 comprimido via oral 1x/dia'},
   {n:'Ezetimiba 10mg comprimido',p:'1 comprimido via oral 1x/dia'},
   {n:'AAS 100mg comprimido',p:'1 comprimido via oral 1x/dia após o almoço'},
   {n:'Clopidogrel 75mg comprimido',p:'1 comprimido via oral 1x/dia'},
   {n:'Rivaroxabana 20mg comprimido',p:'1 comprimido via oral 1x/dia com alimento'},
   {n:'Varfarina 5mg comprimido',p:'via oral 1x/dia, dose conforme INR'},
   {n:'Isossorbida mononitrato 20mg comprimido',p:'1 comprimido via oral de 12/12h'},
   {n:'Digoxina 0,25mg comprimido',p:'1 comprimido via oral 1x/dia'},
   // Endócrino / diabetes / tireoide
   {n:'Metformina 850mg comprimido',p:'1 comprimido via oral de 12/12h após as refeições'},
   {n:'Metformina XR 500mg comprimido',p:'2 comprimidos via oral 1x/dia (jantar)'},
   {n:'Glibenclamida 5mg comprimido',p:'1 comprimido via oral antes do café da manhã'},
   {n:'Gliclazida MR 30mg comprimido',p:'1 comprimido via oral pela manhã'},
   {n:'Dapagliflozina 10mg comprimido',p:'1 comprimido via oral 1x/dia'},
   {n:'Empagliflozina 25mg comprimido',p:'1 comprimido via oral 1x/dia'},
   {n:'Sitagliptina 100mg comprimido',p:'1 comprimido via oral 1x/dia'},
   {n:'Insulina NPH (frasco/refil)',p:'aplicar via subcutânea conforme esquema prescrito'},
   {n:'Insulina regular (frasco/refil)',p:'aplicar via subcutânea conforme esquema prescrito'},
   {n:'Levotiroxina 50mcg comprimido',p:'1 comprimido via oral em jejum, 30 min antes do café'},
   {n:'Prednisona 20mg comprimido',p:'1 comprimido via oral 1x/dia pela manhã — por 5 dias'},
   {n:'Prednisolona 20mg comprimido',p:'1 comprimido via oral 1x/dia pela manhã'},
   {n:'Dexametasona 4mg comprimido',p:'1 comprimido via oral 1x/dia'},
   // Trato gastrointestinal
   {n:'Omeprazol 20mg cápsula',p:'1 cápsula via oral em jejum 1x/dia — por 4 semanas'},
   {n:'Pantoprazol 40mg comprimido',p:'1 comprimido via oral em jejum 1x/dia'},
   {n:'Esomeprazol 40mg comprimido',p:'1 comprimido via oral em jejum 1x/dia'},
   {n:'Domperidona 10mg comprimido',p:'1 comprimido via oral de 8/8h, 30 min antes das refeições'},
   {n:'Metoclopramida 10mg comprimido',p:'1 comprimido via oral de 8/8h se náusea'},
   {n:'Bromoprida 10mg comprimido',p:'1 comprimido via oral de 8/8h antes das refeições'},
   {n:'Ondansetrona 8mg comprimido',p:'1 comprimido via oral de 8/8h se náusea/vômito'},
   {n:'Simeticona 40mg comprimido',p:'1 a 2 comprimidos via oral após as refeições e ao deitar'},
   {n:'Loperamida 2mg comprimido',p:'2 comprimidos via oral no início, depois 1 após cada evacuação (máx. 8/dia)'},
   {n:'Lactulona (lactulose) 667mg/mL xarope',p:'15 a 30 mL via oral 1 a 2x/dia'},
   {n:'Sais para reidratação oral (SRO) sachê',p:'diluir 1 sachê em 1 L de água; oferecer conforme as perdas'},
   // Respiratório / alergia
   {n:'Salbutamol spray 100mcg/dose',p:'2 jatos inalatórios de 6/6h se falta de ar'},
   {n:'Budesonida + Formoterol 200/6mcg inalador',p:'1 inalação de 12/12h'},
   {n:'Beclometasona spray 250mcg/dose',p:'1 jato inalatório de 12/12h'},
   {n:'Brometo de ipratrópio 0,25mg/mL solução',p:'inalar 20 a 40 gotas de 6/6h se necessário'},
   {n:'Loratadina 10mg comprimido',p:'1 comprimido via oral 1x/dia'},
   {n:'Desloratadina 5mg comprimido',p:'1 comprimido via oral 1x/dia'},
   {n:'Cetirizina 10mg comprimido',p:'1 comprimido via oral 1x/dia à noite'},
   {n:'Fexofenadina 180mg comprimido',p:'1 comprimido via oral 1x/dia'},
   {n:'Dexclorfeniramina 2mg comprimido',p:'1 comprimido via oral de 8/8h'},
   {n:'Budesonida spray nasal 32mcg/dose',p:'2 jatos em cada narina 1x/dia'},
   // Psiquiatria / neurologia
   {n:'Sertralina 50mg comprimido',p:'1 comprimido via oral pela manhã'},
   {n:'Fluoxetina 20mg cápsula',p:'1 cápsula via oral pela manhã'},
   {n:'Escitalopram 10mg comprimido',p:'1 comprimido via oral 1x/dia'},
   {n:'Venlafaxina 75mg comprimido',p:'1 comprimido via oral 1x/dia pela manhã'},
   {n:'Amitriptilina 25mg comprimido',p:'1 comprimido via oral à noite'},
   {n:'Clonazepam 2mg comprimido',p:'1 comprimido via oral à noite',c:1},
   {n:'Diazepam 10mg comprimido',p:'1 comprimido via oral à noite',c:1},
   {n:'Alprazolam 0,5mg comprimido',p:'1 comprimido via oral à noite',c:1},
   {n:'Zolpidem 10mg comprimido',p:'1 comprimido via oral ao deitar',c:1},
   {n:'Quetiapina 25mg comprimido',p:'1 comprimido via oral à noite',c:1},
   {n:'Gabapentina 300mg cápsula',p:'1 cápsula via oral de 8/8h'},
   {n:'Pregabalina 75mg cápsula',p:'1 cápsula via oral de 12/12h'},
   {n:'Carbamazepina 200mg comprimido',p:'1 comprimido via oral de 12/12h',c:1},
   {n:'Levetiracetam 500mg comprimido',p:'1 comprimido via oral de 12/12h'},
   // Reumato / outros
   {n:'Alopurinol 300mg comprimido',p:'1 comprimido via oral 1x/dia após refeição'},
   {n:'Colchicina 0,5mg comprimido',p:'1 comprimido via oral de 12/12h'},
   {n:'Carbonato de cálcio 600mg + Vitamina D comprimido',p:'1 comprimido via oral 1x/dia'},
   {n:'Vitamina D 50.000 UI cápsula',p:'1 cápsula via oral 1x/semana — por 8 semanas'},
   {n:'Sulfato ferroso 40mg Fe comprimido',p:'1 comprimido via oral em jejum 1x/dia com vitamina C'},
   {n:'Ácido fólico 5mg comprimido',p:'1 comprimido via oral 1x/dia'},
   {n:'Tansulosina 0,4mg cápsula',p:'1 cápsula via oral 1x/dia após a mesma refeição'},
   {n:'Finasterida 5mg comprimido',p:'1 comprimido via oral 1x/dia'},
   {n:'Dimenidrinato 50mg + Piridoxina comprimido',p:'1 comprimido via oral de 6/6h se náusea/tontura'},
   {n:'Betaistina 24mg comprimido',p:'1 comprimido via oral de 12/12h'},
   {n:'Permetrina 5% loção',p:'aplicar do pescoço para baixo, deixar 8 a 14h, repetir em 7 dias'},
   {n:'Cetoconazol 2% xampu',p:'aplicar no couro cabeludo 2x/semana, deixar agir 5 min'}
  ];

  var EXAMES_COMUNS = ['Hemograma completo', 'Glicemia de jejum', 'Hemoglobina glicada (HbA1c)', 'Colesterol total e frações', 'Triglicerídeos', 'TSH', 'T4 livre', 'Ureia e creatinina', 'TGO/TGP', 'Ácido úrico', 'EAS (urina tipo 1)', 'Urocultura', 'Sódio e potássio', 'Vitamina D', 'Vitamina B12', 'Ferritina', 'PCR', 'ECG', 'Raio-X de tórax', 'USG de abdome total', 'Beta-HCG'];
  var ANALITOS_COMUNS = ['Hemoglobina', 'Glicemia de jejum', 'HbA1c', 'Creatinina', 'Ureia', 'Colesterol total', 'LDL', 'HDL', 'Triglicerídeos', 'TSH', 'T4 livre', 'Potássio', 'Sódio', 'PCR', 'Vitamina D', 'Vitamina B12', 'Ferritina', 'PSA', 'Ácido úrico', 'TGO', 'TGP', 'Peso', 'IMC', 'PA sistólica', 'PA diastólica'];

  var RX_TIPOS = {
    simples: { rotulo: 'Receituário', curto: 'Simples', vias: 1, validade: '', rotulos: [] },
    antimicrobiano: { rotulo: 'Receituário — antimicrobiano', curto: 'Antimicrobiano', vias: 2, validade: '10 dias', rotulos: ['1ª via — farmácia', '2ª via — paciente'] },
    controle: { rotulo: 'Receituário de controle especial', curto: 'Controle especial', vias: 2, validade: '30 dias', rotulos: ['1ª via — retenção na farmácia', '2ª via — orientação ao paciente'] }
  };
  /* Substâncias que exigem Notificação de Receita oficial (listas A/B): o app avisa e não imprime. */
  var RE_AB = /\b(clonazepam|diazepam|alprazolam|lorazepam|bromazepam|midazolam|clobazam|nitrazepam|flunitrazepam|cloxazolam|zolpidem|zopiclona|eszopiclona|fenobarbital|metilfenidato|lisdexanfetamina|anfepramona|femproporex|mazindol|sibutramina|morfina|metadona|oxicodona|fentanil|petidina|hidromorfona|buprenorfina)\b/;
  /* Receita de controle especial (lista C1 e correlatos em concentrações permitidas). */
  var RE_CONTROLE = /\b(tramadol|codeina|sertralina|fluoxetina|escitalopram|citalopram|paroxetina|fluvoxamina|venlafaxina|desvenlafaxina|duloxetina|amitriptilina|nortriptilina|imipramina|clomipramina|mirtazapina|trazodona|bupropiona|vortioxetina|agomelatina|carbamazepina|oxcarbazepina|valproato|valproico|divalproato|lamotrigina|topiramato|gabapentina|pregabalina|fenitoina|levetiracetam|lacosamida|quetiapina|risperidona|olanzapina|haloperidol|aripiprazol|clorpromazina|ziprasidona|clozapina|paliperidona|litio|biperideno|pramipexol|memantina|donepezila|rivastigmina|galantamina|atomoxetina|modafinila|isotretinoina|misoprostol|cetamina|naltrexona)\b/;
  /* Antimicrobianos (receita em 2 vias, validade 10 dias). */
  var RE_ANTI = /\b(amoxicilina|clavulanato|ampicilina|penicilina|benzilpenicilina|cefalexina|cefadroxila|cefuroxima|cefaclor|ceftriaxona|cefixima|azitromicina|claritromicina|eritromicina|ciprofloxacino|levofloxacino|norfloxacino|moxifloxacino|sulfametoxazol|trimetoprima|doxiciclina|minociclina|tetraciclina|metronidazol|secnidazol|tinidazol|nitrofurantoina|fosfomicina|clindamicina|linezolida|vancomicina|rifampicina|isoniazida|aciclovir|valaciclovir|fanciclovir|oseltamivir|fluconazol|itraconazol|cetoconazol|terbinafina|nistatina|miconazol|griseofulvina|ivermectina|albendazol|mebendazol|praziquantel|nitazoxanida|mupirocina|neomicina|gentamicina|tobramicina|cloranfenicol|fusidico|retapamulina|sulfadiazina|dapsona)\b/;
  var DOC_TIPOS = { declaracao: 'Declaração', encaminhamento: 'Encaminhamento', relatorio: 'Relatório', consentimento: 'Termo de consentimento', atestado: 'Atestado', exames: 'Pedido de exames' };
  var DOC_MODELOS = {
    declaracao: 'Declaro, para os devidos fins, que {{nome}}, CPF {{cpf}}, esteve em atendimento nesta clínica em {{data}}.\n\n[complete aqui o motivo da declaração]',
    encaminhamento: 'Encaminho o(a) paciente {{nome}}, {{idade}}, para avaliação em {{destino}}.\n\nResumo do caso: [não informado]\nHipótese diagnóstica: [não informado]\nExames relevantes: [não informado]\nMotivo do encaminhamento: [não informado]\n\nColoco-me à disposição para esclarecimentos.',
    relatorio: 'Relatório referente ao(à) paciente {{nome}}, nascido(a) em {{nasc}}, CPF {{cpf}}, em acompanhamento nesta clínica.\n\nHistórico: [não informado]\nSituação atual: [não informado]\nTratamento em curso: [não informado]\nConclusão: [não informado]',
    consentimento: 'Eu, {{nome}}, CPF {{cpf}}, declaro que fui informado(a) por {{prof}}, de forma clara e em linguagem acessível, sobre o procedimento {{procedimento}}, seus objetivos, benefícios esperados, alternativas e possíveis riscos e complicações, entre eles: {{riscos}}.\n\nTive a oportunidade de fazer perguntas e todas foram respondidas. Entendo que posso retirar este consentimento a qualquer momento, antes da realização do procedimento.\n\nAssim, autorizo a realização do procedimento acima.\n\n{{clinica}}, {{data}}.'
  };
  var LIMITE_BLOCO_S = 25 * 60, AVISO_BLOCO_S = 22 * 60;
  /* Estilos extras dos corpos impressos (o A4 base vem de CL.print). */
  var DOC_CSS_EXTRA = '<style>.doc-controle{margin-top:8mm;font-size:9.5pt}.doc-tab{width:100%;border-collapse:collapse;margin-top:3mm}.doc-tab td{border:1px solid #000;padding:2mm;vertical-align:top;width:50%;line-height:1.9}.doc-assinaturas{display:flex;justify-content:space-between;gap:10mm;margin-top:14mm}.doc-assinaturas .doc-assinatura{margin:0;flex:1;width:auto}</style>';

  /* =================== utilitários =================== */
  function pac(id) { return CL.get('pacientes', id); }
  function agoraISO() { return new Date().toISOString(); }
  function msDe(v, fallback) { if (typeof v === 'number') return v; var t = Date.parse(v); return isNaN(t) ? (fallback || 0) : t; }
  function profDe(id) { return (id && CL.get('profissionais', id)) || null; }
  function profissionalAtual(consulta) {
    var s = CL.session;
    var p = consulta ? profDe(consulta.profId) : null;
    if (!p && s && s.profId) p = profDe(s.profId);
    if (!p) p = CL.col('profissionais').filter(function (x) { return x.ativo !== false; })[0] || null;
    return p || { id: null, nome: s ? s.nome : '' };
  }
  function iaOk() { return !!(window.Backend && Backend.ai && typeof Backend.ai.disponivel === 'function' && Backend.ai.disponivel()); }
  function avisarIA() {
    CL.ui.toast('Configure o backend para usar a IA (Ajustes › Sobre)', { kind: 'aviso', action: { rotulo: 'Abrir', fn: function () { CL.route.go('#/config/sobre'); } } });
  }
  function erroIA(err) {
    var msg = (err && err.message) || 'falha desconhecida';
    if (/configure o backend/i.test(msg)) avisarIA();
    else CL.ui.toast('A IA não respondeu: ' + msg, { kind: 'erro' });
  }
  function podeAbrirProntuario() {
    if (CL.can('clinico')) return true;
    CL.ui.toast('Seu perfil não abre o prontuário', { kind: 'aviso' });
    return false;
  }
  function alergiasDe(p) {
    return String((p && p.alergias) || '').split(/[,;\/\n]+/).map(function (s) { return CL.util.norm(s); }).filter(function (s) { return s.length >= 3; });
  }
  function alergiaHit(p, nome) {
    var n = CL.util.norm(nome);
    if (!n) return '';
    var lista = alergiasDe(p);
    for (var i = 0; i < lista.length; i++) if (n.indexOf(lista[i]) >= 0) return lista[i];
    return '';
  }
  var UN = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  var DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  var CEN = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  function numeroExtenso(n) {
    n = Math.floor(Math.abs(Number(n) || 0));
    if (n === 0) return 'zero';
    if (n >= 10000) return String(n);
    var mil = Math.floor(n / 1000), resto = n % 1000, partes = [];
    if (mil) partes.push(mil === 1 ? 'mil' : numeroExtenso(mil) + ' mil');
    if (resto) {
      if (resto === 100) partes.push('cem');
      else {
        var c = Math.floor(resto / 100), r = resto % 100, sub = [];
        if (c) sub.push(CEN[c]);
        if (r) sub.push(r < 20 ? UN[r] : DEZ[Math.floor(r / 10)] + (r % 10 ? ' e ' + UN[r % 10] : ''));
        partes.push(sub.join(' e '));
      }
    }
    if (partes.length === 2) return partes[0] + ((resto < 100 || resto % 100 === 0) ? ' e ' : ' ') + partes[1];
    return partes[0];
  }
  function extensoDeQtd(qtd) {
    var m = String(qtd || '').match(/\d+/);
    if (!m) return '';
    var n = parseInt(m[0], 10);
    var resto = String(qtd).replace(/^\s*\d+\s*/, '').trim();
    return numeroExtenso(n) + (resto ? ' ' + resto : '');
  }
  function fmtSeg(s) {
    s = Math.max(0, Math.floor(s));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    var mm = (m < 10 ? '0' : '') + m, ss = (x < 10 ? '0' : '') + x;
    return h ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }
  function chipTipo(rotulo, cls) { return '<span class="chip ' + (cls || '') + '">' + e(rotulo) + '</span>'; }
  function preHtml(texto) { return '<div class="hist-pre">' + e(texto || '') + '</div>'; }
  function botao(acao, rotulo, icone, cls, extra) {
    return '<button type="button" class="btn ' + (cls || 'btn-neutro') + '" data-acao="' + acao + '"' + (extra || '') + '>' + (icone ? '<i class="ti ' + icone + '" aria-hidden="true"></i>' : '') + e(rotulo) + '</button>';
  }
  function campo(rotulo, inner, cls) { return '<div class="campo' + (cls ? ' ' + cls : '') + '">' + (rotulo ? '<label class="campo-rotulo">' + rotulo + '</label>' : '') + inner + '</div>'; }
  function opcoes(lista, atual) {
    return lista.map(function (o) { return '<option value="' + e(o[0]) + '"' + (String(atual) === String(o[0]) ? ' selected' : '') + '>' + e(o[1]) + '</option>'; }).join('');
  }
  function registrarCompartilhamento(pacId, tipo, alvo) {
    if (window.Pacientes && typeof Pacientes.registrarCompartilhamento === 'function') Pacientes.registrarCompartilhamento(pacId, tipo, alvo);
  }
  function abrirWa(pacId, texto) {
    var p = pac(pacId);
    var d = CL.util.digits(p && p.fone);
    if (d.length < 10) { CL.ui.toast('Cadastre o telefone do paciente na ficha para enviar pelo WhatsApp', { kind: 'aviso' }); return false; }
    var num = (d.slice(0, 2) === '55' && d.length > 11) ? d : '55' + d;
    registrarCompartilhamento(pacId, 'whatsapp', 'texto de documento');
    window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(texto), '_blank', 'noopener');
    return true;
  }

  /* =================== prévia e impressão =================== */
  function abrirPrevia(o) {
    var corpo = document.createElement('div');
    corpo.className = 'doc-previa';
    var iframe = document.createElement('iframe');
    iframe.title = 'Prévia do documento';
    iframe.srcdoc = CL.print.montar(o);
    corpo.appendChild(iframe);
    return CL.ui.modal({
      titulo: 'Prévia — ' + (o.titulo || 'Documento'), corpo: corpo, largo: true,
      botoes: [
        { rotulo: 'Fechar', tipo: 'neutro' },
        { rotulo: 'Imprimir / Salvar PDF', tipo: 'primario', icone: 'ti-printer', acao: function () { CL.print.documento(o); } }
      ]
    });
  }

  /* =================== rascunhos ===================
     Chave própria (clinicar.v1.rascunhos): é texto clínico, então sai junto com o resto no "Sair" — nunca no pref,
     a única chave que o logout preserva. Rascunhos com mais de 30 dias são descartados ao abrir. */
  var CHAVE_RASCUNHOS = 'clinicar.v1.rascunhos', DIAS_RASCUNHO = 30;
  var rascunho = {
    todos: function () {
      var r = null;
      try { r = JSON.parse(localStorage.getItem(CHAVE_RASCUNHOS)); } catch (e) { r = null; }
      return (r && typeof r === 'object' && !Array.isArray(r)) ? r : {};
    },
    gravar: function (t) {
      try { if (Object.keys(t).length) localStorage.setItem(CHAVE_RASCUNHOS, JSON.stringify(t)); else localStorage.removeItem(CHAVE_RASCUNHOS); }
      catch (e) { /* cota cheia: o texto continua na tela */ }
    },
    get: function (chave) { return rascunho.todos()[chave] || null; },
    set: function (chave, dados) {
      var t = rascunho.todos();
      var d = typeof dados === 'string' ? { texto: dados } : (dados || {});
      t[chave] = Object.assign({}, d, { em: Date.now() });
      rascunho.gravar(t);
    },
    limpar: function (chave) { var t = rascunho.todos(); delete t[chave]; rascunho.gravar(t); },
    /* Move o que versões anteriores deixaram no pref e apaga rascunhos velhos. */
    arrumar: function () {
      var t = rascunho.todos(), mudou = false;
      var velhos = CL.pref.get('rascunhos', null);
      if (velhos && typeof velhos === 'object') {
        Object.keys(velhos).forEach(function (k) { if (!t[k]) { t[k] = velhos[k]; mudou = true; } });
        CL.pref.set('rascunhos', undefined);
      }
      var limite = Date.now() - DIAS_RASCUNHO * 86400000;
      Object.keys(t).forEach(function (k) { var em = +(t[k] && t[k].em) || 0; if (em && em < limite) { delete t[k]; mudou = true; } });
      if (mudou) rascunho.gravar(t);
    }
  };
  try { rascunho.arrumar(); } catch (e) { console.error('[Atendimento] rascunhos', e); }

  /* =================== ditado (Web Speech) =================== */
  var ditado = { rec: null, ativo: false, onTexto: null };
  var ditar = {
    disponivel: function () { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); },
    iniciar: function (onTexto) {
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { CL.ui.toast('Este navegador não faz ditado por voz. Use o Google Chrome.', { kind: 'aviso' }); return false; }
      if (ditado.ativo) ditar.parar();
      var rec = new SR();
      rec.lang = 'pt-BR'; rec.continuous = true; rec.interimResults = true;
      rec.onresult = function (ev) {
        var fin = '';
        for (var i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) fin += ev.results[i][0].transcript;
        if (fin && typeof ditado.onTexto === 'function') ditado.onTexto(fin.trim());
      };
      rec.onerror = function (ev) {
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { CL.ui.toast('Permita o acesso ao microfone para ditar', { kind: 'erro' }); ditar.parar(); }
      };
      rec.onend = function () { if (ditado.ativo && ditado.rec === rec) { try { rec.start(); } catch (err) { /* reinício negado */ } } };
      try { rec.start(); } catch (err) { CL.ui.toast('Não foi possível iniciar o microfone', { kind: 'erro' }); return false; }
      ditado.rec = rec; ditado.ativo = true; ditado.onTexto = onTexto;
      return true;
    },
    parar: function () {
      ditado.ativo = false;
      if (ditado.rec) { try { ditado.rec.stop(); } catch (err) { /* já parado */ } }
      ditado.rec = null; ditado.onTexto = null;
    },
    emAndamento: function () { return ditado.ativo; }
  };

  /* =================== gravação da consulta (MediaRecorder) =================== */
  var grav = { rec: null, stream: null, chunks: [], segs: 0, timer: null, onTick: null, resolverParada: null, avisou: false };
  function mimeAudio() {
    var c = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
    for (var i = 0; i < c.length; i++) if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c[i])) return c[i];
    return '';
  }
  function pararStream() { if (grav.stream) { grav.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (err) { /* já parado */ } }); grav.stream = null; } }
  function blobParaB64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onloadend = function () { var s = String(r.result || ''); var i = s.indexOf(','); res(i >= 0 ? s.slice(i + 1) : s); };
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }
  var gravar = {
    disponivel: function () { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder); },
    emAndamento: function () { return !!(grav.rec && grav.rec.state === 'recording'); },
    segundos: function () { return grav.segs; },
    iniciar: function (o) {
      o = o || {};
      if (!gravar.disponivel()) return Promise.reject(new Error('Este navegador não grava áudio. Use o Google Chrome.'));
      if (!iaOk()) return Promise.reject(new Error('configure o backend'));
      if (gravar.emAndamento()) return Promise.resolve();
      return navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
        grav.stream = stream; grav.chunks = []; grav.segs = 0; grav.avisou = false; grav.onTick = o.onTick || null;
        var mime = mimeAudio();
        try { grav.rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 }); }
        catch (err) { try { grav.rec = new MediaRecorder(stream); } catch (err2) { pararStream(); throw new Error('Não foi possível iniciar a gravação'); } }
        grav.rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) grav.chunks.push(ev.data); };
        grav.rec.onstop = function () {
          pararStream();
          clearInterval(grav.timer); grav.timer = null;
          var blob = new Blob(grav.chunks, { type: (grav.chunks[0] && grav.chunks[0].type) || 'audio/webm' });
          var seg = grav.segs, resolver = grav.resolverParada;
          grav.resolverParada = null; grav.rec = null;
          if (!blob.size) { if (resolver) resolver(null); return; }
          blobParaB64(blob).then(function (b64) { if (resolver) resolver({ base64: b64, mime: (blob.type || 'audio/webm').split(';')[0], seg: seg }); });
        };
        grav.rec.start(1000);
        grav.timer = setInterval(function () {
          grav.segs++;
          if (typeof grav.onTick === 'function') grav.onTick(grav.segs);
          if (grav.segs === AVISO_BLOCO_S && !grav.avisou) { grav.avisou = true; CL.ui.toast('Faltam 3 minutos para o limite deste bloco de gravação', { kind: 'aviso' }); }
          if (grav.segs >= LIMITE_BLOCO_S && typeof o.aoLimite === 'function') o.aoLimite();
        }, 1000);
      }, function () { throw new Error('Permita o acesso ao microfone para gravar'); });
    },
    parar: function () {
      if (!gravar.emAndamento()) return Promise.resolve(null);
      return new Promise(function (res) { grav.resolverParada = res; try { grav.rec.stop(); } catch (err) { res(null); } });
    },
    cancelar: function () {
      clearInterval(grav.timer); grav.timer = null;
      grav.resolverParada = null;
      if (grav.rec) { try { grav.rec.ondataavailable = null; grav.rec.onstop = null; grav.rec.stop(); } catch (err) { /* já parado */ } }
      grav.rec = null; grav.chunks = []; pararStream();
    }
  };

  /* =================== IA: prompts =================== */
  function encounterCtx(tipoAtend, pacId, ignorarId) {
    var p = pac(pacId) || {};
    if (tipoAtend === 'retorno') {
      var prev = CL.col('evolucoes').filter(function (r) { return r.pacId === pacId && r.id !== ignorarId; }).sort(function (a, b) { return msDe(b.data) - msDe(a.data); })[0];
      var c = 'CONTEXTO: esta é uma consulta de RETORNO. Resuma brevemente o caso já conhecido, FOQUE na evolução do intervalo (queixas novas, resposta ao tratamento, exames trazidos) e no DIRECIONAMENTO/ajuste de conduta — não repita a anamnese completa.';
      if (prev && prev.texto) c += '\n\nEVOLUÇÃO ANTERIOR (' + CL.fmt.data(CL.util.ymd(new Date(msDe(prev.data, prev.createdAt)))) + '):\n' + prev.texto;
      return c + '\n\n';
    }
    if (tipoAtend === 'nova') {
      var c2 = 'CONTEXTO: esta é uma NOVA consulta de um paciente JÁ CONHECIDO. Faça a anamnese do problema atual de forma completa, mas APROVEITE os dados já conhecidos abaixo (não re-pergunte o que já está registrado; atualize apenas se houver mudança).';
      var base = [p.problemas ? 'Problemas/comorbidades: ' + p.problemas : '', p.meds ? 'Medicações em uso: ' + p.meds : '', p.alergias ? 'Alergias: ' + p.alergias : ''].filter(Boolean).join('\n');
      if (base) c2 += '\n\nDADOS JÁ CONHECIDOS:\n' + base;
      return c2 + '\n\n';
    }
    return 'CONTEXTO: esta é a PRIMEIRA consulta deste paciente. Faça uma ANAMNESE COMPLETA: identificação, queixa principal, história da doença atual, antecedentes pessoais e familiares, hábitos de vida, medicações em uso, alergias, exame físico, hipóteses diagnósticas e conduta.\n\n';
  }
  function estruturar(o) {
    o = o || {};
    if (!iaOk()) return Promise.reject(new Error('configure o backend'));
    var raw = String(o.rascunho || '').trim();
    if (!raw) return Promise.reject(new Error('Dite ou digite o caso antes de estruturar'));
    var prompt = PROMPT_BASE + '\n\n' + encounterCtx(o.tipoAtend || 'primeira', o.pacId, o.ignorarId) + (REC_FMT[o.formato] || REC_FMT.evolucao).ai + '\n\nTranscrição/rascunho:\n' + raw;
    return Backend.ai.texto(prompt, { model: 'gemini-2.5-pro' }).then(function (t) { return String(t || '').trim(); });
  }
  function transcrever(o) {
    o = o || {};
    if (!iaOk()) return Promise.reject(new Error('configure o backend'));
    var prompt = PROMPT_AUDIO + '\n\n' + encounterCtx(o.tipoAtend || 'primeira', o.pacId, o.ignorarId) + (REC_FMT[o.formato] || REC_FMT.evolucao).ai;
    return Backend.ai.audio(o.base64, o.mime || 'audio/webm', prompt, { model: 'gemini-2.5-pro' }).then(function (t) { return String(t || '').trim(); });
  }
  function resumoPaciente(pacId) {
    if (!iaOk()) return Promise.reject(new Error('configure o backend'));
    var p = pac(pacId);
    if (!p) return Promise.reject(new Error('Paciente não encontrado'));
    var recs = CL.col('evolucoes').filter(function (r) { return r.pacId === pacId; }).sort(function (a, b) { return msDe(a.data) - msDe(b.data); });
    if (!recs.length) return Promise.reject(new Error('Este paciente ainda não tem evoluções para resumir'));
    var hist = recs.map(function (r) { return CL.fmt.data(CL.util.ymd(new Date(msDe(r.data, r.createdAt)))) + ' [' + (REC_FMT[r.tipo] || REC_FMT.evolucao).l + ']: ' + r.texto; }).join('\n\n');
    var idade = CL.fmt.idade(p.nasc);
    var ctx = 'Paciente: ' + p.nome + (idade ? ', ' + idade : '') + '. ' + (p.problemas ? 'Problemas: ' + p.problemas + '. ' : '') + (p.alergias ? 'Alergias: ' + p.alergias + '. ' : '') + (p.meds ? 'Medicações em uso: ' + p.meds + '.' : '');
    var prompt = 'Você é um assistente clínico. Com base no histórico de evoluções abaixo, escreva um RESUMO CLÍNICO do paciente para leitura rápida antes da consulta, em português do Brasil. Estruture em: Problemas ativos; Evolução recente; Medicações; Pendências/seguimento. Use linhas curtas iniciadas por hífen, sem markdown; NÃO invente dados que não estejam no histórico.\n\n' + ctx + '\n\nEvoluções (mais antigas → mais recentes):\n' + hist;
    return Backend.ai.texto(prompt, { model: 'gemini-2.5-pro' }).then(function (t) { return String(t || '').trim(); });
  }
  function abrirResumo(pacId) {
    if (!podeAbrirProntuario()) return;
    if (!iaOk()) { avisarIA(); return; }
    var p = pac(pacId);
    if (!p) return;
    var corpo = document.createElement('div');
    corpo.className = 'pilha';
    corpo.innerHTML = '<p class="ajuda">Síntese das evoluções para leitura rápida. Revise — a IA não substitui o prontuário.</p><div class="hist-pre resumo-ia" aria-live="polite">Gerando resumo…</div>';
    var saida = corpo.querySelector('.resumo-ia');
    var texto = '';
    CL.ui.modal({
      titulo: 'Resumo do paciente', corpo: corpo, largo: true,
      botoes: [
        { rotulo: 'Copiar', tipo: 'neutro', icone: 'ti-copy', fecha: false, acao: function () { if (texto && navigator.clipboard) navigator.clipboard.writeText(texto).then(function () { CL.ui.toast('Resumo copiado', { kind: 'ok' }); }); } },
        { rotulo: 'Fechar', tipo: 'primario' }
      ]
    });
    resumoPaciente(pacId).then(function (t) { texto = t; saida.textContent = t || 'Sem resposta.'; }, function (err) { saida.textContent = ''; erroIA(err); saida.textContent = 'Não foi possível gerar o resumo.'; });
  }

  /* =================== evolução: persistência =================== */
  function salvarEvolucao(d) {
    d = d || {};
    var texto = String(d.texto || '').trim();
    if (!texto) throw new Error('Escreva ou gere o texto da evolução antes de salvar');
    var titulo = String(d.titulo || '').trim();
    if (!titulo) titulo = (texto.split('\n').map(function (s) { return s.trim(); }).filter(Boolean)[0] || 'Evolução').replace(/^[#*•\-\s]+/, '').slice(0, 60);
    var usuario = CL.session ? CL.session.nome : '';
    var ev;
    if (d.id && CL.get('evolucoes', d.id)) {
      var ant = CL.get('evolucoes', d.id);
      var versoes = Array.isArray(ant.versoes) ? ant.versoes.slice() : [];
      versoes.push({ em: ant.updatedAt || ant.createdAt || Date.now(), usuario: ant.usuario || '', titulo: ant.titulo || '', texto: ant.texto || '' });
      ev = CL.patch('evolucoes', d.id, { tipo: d.tipo || ant.tipo, tipoAtend: d.tipoAtend || ant.tipoAtend, titulo: titulo, texto: texto, versoes: versoes, retificadoEm: Date.now(), usuario: usuario, origem: d.origem || ant.origem || 'manual' });
      CL.audit('evolucao.editar', 'evolucoes', ev.id, { pacId: ev.pacId });
    } else {
      ev = CL.upsert('evolucoes', {
        pacId: d.pacId, profId: d.profId || profissionalAtual().id || null, consultaId: d.consultaId || null, data: agoraISO(),
        tipo: d.tipo || 'evolucao', tipoAtend: d.tipoAtend || '', titulo: titulo, texto: texto, versoes: [], usuario: usuario, origem: d.origem || 'manual'
      });
      CL.audit('evolucao.criar', 'evolucoes', ev.id, { pacId: ev.pacId });
      if (d.consultaId && CL.get('consultas', d.consultaId)) CL.patch('consultas', d.consultaId, { evolucaoId: ev.id });
    }
    return ev;
  }

  /* =================== evolução: editor (inline ou em drawer) =================== */
  function criarEditor(container, o) {
    o = o || {};
    var p = pac(o.pacId) || {};
    var base = o.id ? CL.get('evolucoes', o.id) : null;
    var prevN = CL.col('evolucoes').filter(function (x) { return x.pacId === o.pacId && x.id !== o.id; }).length;
    var st = {
      tipo: base ? (base.tipo || 'evolucao') : 'soap', tipoAtend: base ? (base.tipoAtend || 'retorno') : (prevN ? 'retorno' : 'primeira'),
      titulo: base ? (base.titulo || '') : '', raw: '', texto: base ? (base.texto || '') : '', origem: base ? (base.origem || 'manual') : 'manual'
    };
    var chave = o.chave || (o.consultaId ? 'consulta:' + o.consultaId : (o.id ? 'evolucao:' + o.id : 'paciente:' + o.pacId));
    var r = rascunho.get(chave), recuperado = 0;
    if (r && (r.raw || (r.texto && r.texto !== st.texto))) {
      st.raw = r.raw || ''; st.texto = r.texto || st.texto; st.titulo = r.titulo || st.titulo; st.tipo = r.tipo || st.tipo; st.tipoAtend = r.tipoAtend || st.tipoAtend;
      recuperado = r.em || Date.now();
    }
    var consentiu = false;
    try { consentiu = sessionStorage.getItem('ca.consent.gravacao') === '1'; } catch (err) { consentiu = false; }
    var ia = iaOk();
    container.innerHTML = '<div class="ev-editor">' +
      (base ? '<div class="aviso-inline is-info"><i class="ti ti-info-circle" aria-hidden="true"></i><span>A versão anterior fica guardada ao salvar (retificação).</span></div>' : '') +
      '<div class="aviso-inline" data-ev="recuperado"' + (recuperado ? '' : ' hidden') + '><i class="ti ti-history" aria-hidden="true"></i><span>Rascunho recuperado de ' + e(recuperado ? CL.fmt.dataHora(recuperado) : '') + '.</span><button type="button" class="btn-link" data-ev="descartar">Descartar rascunho</button></div>' +
      '<div class="campos ev-contexto">' +
      campo('Tipo de atendimento', '<select class="select" data-ev="tipoAtend">' + opcoes(Object.keys(ATEND_TIPOS).map(function (k) { return [k, ATEND_TIPOS[k]]; }), st.tipoAtend) + '</select>') +
      campo('Formato', '<select class="select" data-ev="tipo">' + opcoes(Object.keys(REC_FMT).map(function (k) { return [k, REC_FMT[k].l]; }), st.tipo) + '</select>') +
      campo('Título (opcional)', '<input class="input" type="text" data-ev="titulo" autocomplete="off" placeholder="Ex.: Retorno cardiologia" value="' + e(st.titulo) + '">') +
      '</div>' +
      '<div class="ev-captura"><div class="ev-toolbar">' +
      '<button type="button" class="btn btn-neutro" data-ev="gravar"><i class="ti ti-player-record" aria-hidden="true"></i><span>Gravar consulta</span></button>' +
      '<button type="button" class="btn btn-neutro" data-ev="ditar"><i class="ti ti-microphone" aria-hidden="true"></i><span>Ditar</span></button>' +
      '<span class="ev-tempo tnum" data-ev="tempo" aria-live="polite"></span><span style="flex:1"></span>' +
      '<button type="button" class="btn btn-fantasma btn-pequeno" data-ev="limpar">Limpar rascunho</button>' +
      '<button type="button" class="btn btn-primario" data-ev="estruturar"><i class="ti ti-sparkles" aria-hidden="true"></i><span>Estruturar com IA</span></button></div>' +
      '<label class="campo-linha ev-consent"><input type="checkbox" data-ev="consent"' + (consentiu ? ' checked' : '') + '><span>O paciente consentiu com a gravação da consulta</span></label>' +
      (ia ? '' : '<p class="ajuda ev-ia-off"><i class="ti ti-plug-connected-x" aria-hidden="true"></i> IA não configurada — configure o backend em Ajustes › Sobre para gravar e estruturar.</p>') +
      '<div class="campo"><label class="campo-rotulo">Rascunho, ditado ou transcrição</label><textarea class="textarea" data-ev="raw" rows="5" placeholder="Grave a consulta inteira, dite ou digite o caso. A IA organiza no formato escolhido.">' + e(st.raw) + '</textarea></div></div>' +
      '<div class="campo ev-saida"><label class="campo-rotulo">Texto da evolução</label><textarea class="textarea" data-ev="texto" rows="12" placeholder="O texto estruturado aparece aqui. Edite livremente antes de salvar.">' + e(st.texto) + '</textarea>' +
      '<p class="ajuda"><i class="ti ti-alert-triangle" aria-hidden="true"></i> A IA é apoio: revise antes de salvar.</p></div>' +
      (o.inline ? '<div class="linha-acoes ev-rodape"><span class="ajuda" data-ev="estado"></span><span style="flex:1"></span><button type="button" class="btn btn-primario" data-ev="salvar"><i class="ti ti-device-floppy" aria-hidden="true"></i>Salvar evolução</button></div>' : '') +
      '</div>';
    var q = function (sel) { return container.querySelector('[data-ev="' + sel + '"]'); };
    var elRaw = q('raw'), elTexto = q('texto'), elTitulo = q('titulo'), elTipo = q('tipo'), elAtend = q('tipoAtend'), elTempo = q('tempo'), bGravar = q('gravar'), bDitar = q('ditar'), bEstr = q('estruturar'), elConsent = q('consent');
    var vivo = true;
    var salvarRascunho = CL.util.debounce(function () {
      if (!vivo) return;
      rascunho.set(chave, { raw: st.raw, texto: st.texto, titulo: st.titulo, tipo: st.tipo, tipoAtend: st.tipoAtend });
    }, 1500);
    function marcar() { salvarRascunho(); }
    elRaw.addEventListener('input', function () { st.raw = elRaw.value; marcar(); });
    elTexto.addEventListener('input', function () { st.texto = elTexto.value; marcar(); });
    elTitulo.addEventListener('input', function () { st.titulo = elTitulo.value; marcar(); });
    elTipo.addEventListener('change', function () { st.tipo = elTipo.value; marcar(); });
    elAtend.addEventListener('change', function () { st.tipoAtend = elAtend.value; marcar(); });
    elConsent.addEventListener('change', function () { try { sessionStorage.setItem('ca.consent.gravacao', elConsent.checked ? '1' : '0'); } catch (err) { /* sem storage */ } });
    function estado(txt) { var el = q('estado'); if (el) el.textContent = txt || ''; }
    function ocupado(b, txt) {
      if (!b) return;
      if (txt) { b.disabled = true; b.setAttribute('data-rotulo', b.querySelector('span').textContent); b.querySelector('span').textContent = txt; }
      else { b.disabled = false; var r0 = b.getAttribute('data-rotulo'); if (r0) b.querySelector('span').textContent = r0; }
    }
    function atualizarBotoes() {
      var g = gravar.emAndamento(), d = ditar.emAndamento();
      bGravar.querySelector('i').className = 'ti ' + (g ? 'ti-player-stop' : 'ti-player-record');
      bGravar.querySelector('span').textContent = g ? 'Parar e gerar' : 'Gravar consulta';
      bGravar.classList.toggle('is-ativo', g);
      bDitar.querySelector('i').className = 'ti ' + (d ? 'ti-player-stop' : 'ti-microphone');
      bDitar.querySelector('span').textContent = d ? 'Parar ditado' : 'Ditar';
      bDitar.classList.toggle('is-ativo', d);
      if (!g && !d) elTempo.textContent = '';
      else if (d && !g) elTempo.textContent = 'ouvindo…';
    }
    function anexarTexto(t) {
      if (!t) return;
      st.texto = (st.texto ? st.texto.replace(/\s+$/, '') + '\n\n' : '') + t;
      elTexto.value = st.texto;
      marcar();
    }
    var ultimoAudio = null;
    function processarAudio(a) {
      if (!a || !vivo) return;
      ultimoAudio = a;
      ocupado(bGravar, 'Transcrevendo e gerando…');
      elTempo.textContent = 'bloco de ' + fmtSeg(a.seg) + ' enviado';
      transcrever({ base64: a.base64, mime: a.mime, tipoAtend: st.tipoAtend, formato: st.tipo, pacId: o.pacId, ignorarId: o.id })
        .then(function (t) { if (!vivo) return; anexarTexto(t); st.origem = 'ia_audio'; CL.ui.toast('Evolução gerada a partir do áudio — revise', { kind: 'ok' }); })
        .catch(function (err) {
          if (!vivo) return;
          if (/configure o backend/i.test(err && err.message)) avisarIA();
          else CL.ui.toast('Não foi possível processar o áudio: ' + err.message, { kind: 'erro', action: { rotulo: 'Tentar de novo', fn: function () { processarAudio(ultimoAudio); } } });
        })
        .then(function () { if (!vivo) return; ocupado(bGravar, ''); atualizarBotoes(); });
    }
    bGravar.addEventListener('click', function () {
      if (gravar.emAndamento()) { gravar.parar().then(processarAudio); atualizarBotoes(); return; }
      if (!iaOk()) { avisarIA(); return; }
      if (!elConsent.checked) { CL.ui.toast('Marque o consentimento do paciente antes de gravar', { kind: 'aviso' }); elConsent.focus(); return; }
      if (ditar.emAndamento()) ditar.parar();
      gravar.iniciar({
        onTick: function (s) { if (vivo) elTempo.textContent = 'gravando ' + fmtSeg(s); },
        aoLimite: function () { CL.ui.toast('Limite de 25 minutos do bloco: gerando a evolução deste trecho', { kind: 'aviso' }); gravar.parar().then(processarAudio); atualizarBotoes(); }
      }).then(atualizarBotoes, function (err) { if (/configure o backend/i.test(err.message)) avisarIA(); else CL.ui.toast(err.message, { kind: 'erro' }); });
    });
    bDitar.addEventListener('click', function () {
      if (ditar.emAndamento()) { ditar.parar(); atualizarBotoes(); return; }
      if (gravar.emAndamento()) { CL.ui.toast('Pare a gravação da consulta antes de ditar', { kind: 'aviso' }); return; }
      ditar.iniciar(function (t) {
        if (!vivo) return;
        st.raw = (st.raw ? st.raw.replace(/\s+$/, '') + ' ' : '') + t;
        elRaw.value = st.raw; elRaw.scrollTop = elRaw.scrollHeight; marcar();
      });
      atualizarBotoes();
    });
    bEstr.addEventListener('click', function () {
      if (!iaOk()) { avisarIA(); return; }
      if (!st.raw.trim()) { CL.ui.toast('Dite ou digite o caso antes de estruturar', { kind: 'aviso' }); elRaw.focus(); return; }
      ocupado(bEstr, 'Gerando…');
      estruturar({ tipoAtend: st.tipoAtend, formato: st.tipo, rascunho: st.raw, pacId: o.pacId, ignorarId: o.id })
        .then(function (t) { if (!vivo) return; st.texto = t; elTexto.value = t; st.origem = 'ia_texto'; marcar(); CL.ui.toast('Texto estruturado — revise antes de salvar', { kind: 'ok' }); })
        .catch(function (err) { if (vivo) erroIA(err); })
        .then(function () { if (vivo) ocupado(bEstr, ''); });
    });
    q('limpar').addEventListener('click', function () { st.raw = ''; elRaw.value = ''; marcar(); elRaw.focus(); });
    q('descartar').addEventListener('click', function () {
      rascunho.limpar(chave);
      st.raw = ''; st.texto = base ? (base.texto || '') : ''; st.titulo = base ? (base.titulo || '') : '';
      elRaw.value = st.raw; elTexto.value = st.texto; elTitulo.value = st.titulo;
      q('recuperado').hidden = true;
    });
    /* O que já está gravado no prontuário: evita rascunho fantasma e salvamento duplicado. */
    var gravado = { texto: base ? (base.texto || '') : '', titulo: base ? (base.titulo || '') : '', raw: '' };
    var ctrl = {
      chave: chave,
      temTexto: function () { return !!st.texto.trim(); },
      dados: function () { return Object.assign({}, st); },
      salvar: function (opts) {
        opts = opts || {};
        if (!st.texto.trim()) { if (!opts.silencioso) { CL.ui.toast('Escreva ou gere o texto da evolução antes de salvar', { kind: 'aviso' }); elTexto.focus(); } return null; }
        if (o.id && st.texto === gravado.texto && st.titulo === gravado.titulo) {
          salvarRascunho.cancelar(); rascunho.limpar(chave);
          if (!opts.silencioso) CL.ui.toast('Nada mudou desde o último salvamento', { kind: 'info' });
          return CL.get('evolucoes', o.id);
        }
        var ev = salvarEvolucao({ id: o.id, pacId: o.pacId, profId: o.profId, consultaId: o.consultaId, tipo: st.tipo, tipoAtend: st.tipoAtend, titulo: st.titulo, texto: st.texto, origem: st.origem });
        var era = o.id;
        o.id = ev.id;
        gravado = { texto: st.texto, titulo: st.titulo, raw: st.raw };
        salvarRascunho.cancelar();
        rascunho.limpar(chave);
        if (!opts.silencioso) CL.ui.toast(era ? 'Evolução retificada' : 'Evolução salva no prontuário', { kind: 'ok' });
        if (typeof o.aoSalvar === 'function') { try { o.aoSalvar(ev); } catch (err) { console.error(err); } }
        return ev;
      },
      destruir: function () {
        vivo = false;
        salvarRascunho.cancelar();
        if (st.raw !== gravado.raw || st.texto !== gravado.texto || st.titulo !== gravado.titulo) {
          if (st.raw.trim() || st.texto.trim()) rascunho.set(chave, { raw: st.raw, texto: st.texto, titulo: st.titulo, tipo: st.tipo, tipoAtend: st.tipoAtend });
        }
        if (ditar.emAndamento()) ditar.parar();
        if (gravar.emAndamento()) gravar.cancelar();
      },
      focar: function () { (st.texto ? elTexto : elRaw).focus(); }
    };
    var bs = q('salvar');
    if (bs) bs.addEventListener('click', function () { ctrl.salvar(); estado('Salvo às ' + CL.util.hhmmDe(new Date())); });
    atualizarBotoes();
    return ctrl;
  }
  function abrirEvolucao(o) {
    o = o || {};
    if (!podeAbrirProntuario()) return null;
    var p = pac(o.pacId);
    if (!p) { CL.ui.toast('Paciente não encontrado', { kind: 'erro' }); return null; }
    var corpo = document.createElement('div');
    var rodape = document.createElement('div');
    rodape.className = 'linha-acoes';
    rodape.innerHTML = '<button type="button" class="btn btn-neutro" data-fecha="1">Cancelar</button><button type="button" class="btn btn-primario" data-acao="salvar"><i class="ti ti-device-floppy" aria-hidden="true"></i>Salvar evolução</button>';
    var ctrl = null;
    var d = CL.ui.drawer({
      titulo: o.id ? 'Editar evolução' : 'Nova evolução', corpo: corpo, rodape: rodape, largura: 'lg',
      aoFechar: function () { if (ctrl) ctrl.destruir(); }
    });
    ctrl = criarEditor(corpo, { pacId: p.id, consultaId: o.consultaId || null, id: o.id || null, aoSalvar: o.aoSalvar });
    rodape.querySelector('[data-acao="salvar"]').addEventListener('click', function () { if (ctrl.salvar()) d.fechar({ motivo: 'salvar' }); });
    setTimeout(function () { ctrl.focar(); }, 50);
    return d;
  }
  function verEvolucao(id) {
    var r = CL.get('evolucoes', id);
    if (!r || !podeAbrirProntuario()) return;
    var f = REC_FMT[r.tipo] || REC_FMT.evolucao;
    var corpo = document.createElement('div');
    corpo.className = 'pilha';
    var meta = chipTipo(f.l, 'chip-acento') + (r.tipoAtend && ATEND_TIPOS[r.tipoAtend] ? ' ' + chipTipo(ATEND_TIPOS[r.tipoAtend]) : '') + ' <span class="texto-3 tnum">' + e(CL.fmt.dataHora(msDe(r.data, r.createdAt))) + '</span>' + (r.usuario ? ' <span class="texto-3">· ' + e(r.usuario) + '</span>' : '');
    var h = '<div>' + meta + '</div>' + preHtml(r.texto);
    if (Array.isArray(r.versoes) && r.versoes.length) {
      h += '<details class="hist-versoes"><summary>Retificado em ' + e(CL.fmt.dataHora(r.retificadoEm || r.updatedAt)) + ' · ' + r.versoes.length + ' versão(ões) anterior(es)</summary>' +
        r.versoes.slice().reverse().map(function (v) { return '<div class="hist-versao"><div class="rotulo">Versão de ' + e(CL.fmt.dataHora(v.em)) + (v.usuario ? ' · ' + e(v.usuario) : '') + (v.titulo ? ' · ' + e(v.titulo) : '') + '</div>' + preHtml(v.texto) + '</div>'; }).join('') + '</details>';
    }
    corpo.innerHTML = h;
    CL.ui.modal({
      titulo: r.titulo || f.l, corpo: corpo, largo: true,
      botoes: [
        { rotulo: 'Imprimir', tipo: 'neutro', icone: 'ti-printer', acao: function () { imprimirEvolucao(id); } },
        { rotulo: 'Editar', tipo: 'neutro', icone: 'ti-pencil', acao: function () { setTimeout(function () { abrirEvolucao({ pacId: r.pacId, id: id }); }, 0); } },
        { rotulo: 'Fechar', tipo: 'primario' }
      ]
    });
  }
  function printEvolucao(r) {
    var f = REC_FMT[r.tipo] || REC_FMT.evolucao;
    return {
      titulo: f.l === 'SOAP' ? 'Evolução clínica (SOAP)' : (f.l === 'Evolução' ? 'Evolução clínica' : f.l),
      corpoHtml: (r.titulo ? '<p><strong>' + e(r.titulo) + '</strong></p>' : '') + '<pre class="doc-pre">' + e(r.texto) + '</pre>' + (r.retificadoEm ? '<p><em>Retificado em ' + e(CL.fmt.dataHora(r.retificadoEm)) + '.</em></p>' : ''),
      paciente: pac(r.pacId), profissional: profDe(r.profId) || profissionalAtual(), tipoDoc: 'evolucao', documentoId: r.id
    };
  }
  function imprimirEvolucao(id) {
    var r = CL.get('evolucoes', id);
    if (!r) return;
    abrirPrevia(printEvolucao(r));
  }

  /* =================== receituário =================== */
  function classificar(nome, flagC) {
    var n = CL.util.norm(nome);
    if (!n) return 'simples';
    if (RE_AB.test(n)) return 'ab';
    if (flagC || RE_CONTROLE.test(n)) return 'controle';
    if (RE_ANTI.test(n)) return 'antimicrobiano';
    return 'simples';
  }
  function buscarMed(q) {
    var nq = CL.util.norm(q);
    if (nq.length < 2) return [];
    var termos = nq.split(/\s+/).filter(Boolean);
    var res = [];
    for (var i = 0; i < MED_DB.length && res.length < 12; i++) {
      var m = MED_DB[i], k = CL.util.norm(m.n);
      var ok = true;
      for (var t = 0; t < termos.length; t++) if (k.indexOf(termos[t]) < 0) { ok = false; break; }
      if (ok) res.push({ n: m.n, p: m.p, c: m.c ? 1 : 0, classe: classificar(m.n, m.c) });
    }
    return res;
  }
  function grupoDe(item, tipoManual) {
    var cl = item.classe || classificar(item.nome);
    if (cl === 'ab' || cl === 'controle') return 'controle';
    if (cl === 'antimicrobiano') return 'antimicrobiano';
    return tipoManual || 'simples';
  }
  function separar(itens, tipoManual) {
    var g = { simples: [], antimicrobiano: [], controle: [] };
    (itens || []).forEach(function (it) {
      if (!it || !String(it.nome || '').trim()) return;
      var cl = classificar(it.nome, it.c);
      var copia = { nome: String(it.nome).trim(), pos: String(it.pos || '').trim(), qtd: String(it.qtd || '').trim(), qtdExtenso: String(it.qtdExtenso || '').trim() };
      if (cl === 'ab') copia.notificacao = true;
      g[grupoDe({ classe: cl }, tipoManual)].push(copia);
    });
    return g;
  }
  function textoReceita(r) {
    return (r.itens || []).map(function (it, i) { return (i + 1) + '. ' + it.nome + (it.pos ? ' — ' + it.pos : '') + (it.qtd ? ' (' + it.qtd + (it.qtdExtenso ? ' — ' + it.qtdExtenso : '') + ')' : ''); }).join('\n') + (r.obs ? '\n\nOrientações: ' + r.obs : '');
  }
  function itensAB(r) { return (r.itens || []).filter(function (it) { return classificar(it.nome) === 'ab'; }); }
  function avisarNotificacao(itens) {
    var corpo = document.createElement('div');
    corpo.className = 'prosa pilha';
    corpo.innerHTML = '<p>Estes medicamentos exigem a <strong>Notificação de Receita oficial</strong> (formulário numerado das listas A/B), que o app não imprime:</p><ul>' + itens.map(function (it) { return '<li>' + e(it.nome) + '</li>'; }).join('') + '</ul><p>Preencha o talonário oficial. A receita fica registrada no prontuário.</p>';
    CL.ui.modal({ titulo: 'Use a Notificação de Receita', corpo: corpo, botoes: [{ rotulo: 'Entendi', tipo: 'primario' }] });
  }
  function printReceita(r) {
    var t = RX_TIPOS[r.tipo] || RX_TIPOS.simples;
    var p = pac(r.pacId);
    var corpo = (r.itens || []).map(function (it, i) {
      return '<div class="doc-item"><span class="doc-item-n">' + (i + 1) + '.</span><div><strong>' + e(it.nome) + '</strong>' + (it.qtd ? ' — ' + e(it.qtd) + (it.qtdExtenso ? ' (' + e(it.qtdExtenso) + ')' : '') : '') + (it.pos ? '<br>' + e(it.pos) : '') + '</div></div>';
    }).join('');
    if (r.obs) corpo += '<p><strong>Orientações:</strong> ' + e(r.obs) + '</p>';
    if (r.tipo === 'controle') {
      corpo += DOC_CSS_EXTRA + '<div class="doc-controle"><p><strong>Paciente:</strong> ' + e(p ? p.nome : '') + (p && p.endereco ? ' · <strong>Endereço:</strong> ' + e(p.endereco) : '') + '</p>' +
        '<table class="doc-tab"><tr><td><strong>Identificação do comprador</strong><br>Nome: ____________________________<br>RG: ______________ Órgão emissor: ______<br>Endereço: _________________________<br>Telefone: ________________</td>' +
        '<td><strong>Identificação do fornecedor</strong><br>Nome: ____________________________<br>Endereço: _________________________<br>Data: ____/____/______<br>Assinatura do farmacêutico: ______________</td></tr></table></div>';
    }
    return { titulo: t.rotulo, corpoHtml: corpo, paciente: p, profissional: profDe(r.profId) || profissionalAtual(), tipoDoc: 'receita', vias: t.vias, rotulosVias: t.rotulos, validade: t.validade, documentoId: r.id || null };
  }
  function imprimirReceita(rOuId) {
    var r = typeof rOuId === 'string' ? CL.get('receitas', rOuId) : rOuId;
    if (!r) return Promise.resolve(false);
    var ab = itensAB(r);
    if (ab.length) { avisarNotificacao(ab); return Promise.resolve(false); }
    abrirPrevia(printReceita(r));
    return Promise.resolve(true);
  }
  var modelos = {
    listar: function (tipo) { return CL.col('modelos').filter(function (m) { return m && (!tipo || m.tipo === tipo); }).sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome), 'pt-BR'); }); },
    salvar: function (tipo, nome, dados) {
      var m = { tipo: tipo, nome: String(nome || '').trim() || 'Modelo' };
      m[tipo] = dados || {};
      return CL.upsert('modelos', m);
    },
    aplicar: function (id) { var m = CL.get('modelos', id); return m ? (m[m.tipo] || null) : null; },
    remover: function (id) { return CL.remove('modelos', id); }
  };
  function selectModelos(tipo, filtro) {
    var lista = modelos.listar(tipo).filter(function (m) { return !filtro || filtro(m); });
    return '<div class="modelo-linha"><select class="select" data-campo="modelo" aria-label="Modelo"><option value="">— modelo —</option>' + lista.map(function (m) { return '<option value="' + e(m.id) + '">' + e(m.nome) + '</option>'; }).join('') + '</select>' +
      '<button type="button" class="btn btn-neutro" data-acao="aplicar-modelo">Aplicar</button><button type="button" class="btn btn-fantasma" data-acao="salvar-modelo" title="Salvar o conteúdo atual como modelo"><i class="ti ti-star" aria-hidden="true"></i>Salvar modelo</button></div>';
  }
  function abrirReceita(o) {
    o = o || {};
    if (!podeAbrirProntuario()) return null;
    var p = pac(o.pacId);
    if (!p) { CL.ui.toast('Paciente não encontrado', { kind: 'erro' }); return null; }
    var base = o.id ? CL.get('receitas', o.id) : null;
    var rx = { pacId: p.id, profId: (base && base.profId) || (o.consulta && o.consulta.profId) || profissionalAtual().id, tipo: base ? (base.tipo === 'ab' ? 'controle' : base.tipo) : 'simples', itens: [], obs: base ? (base.obs || '') : '', alergiaOk: false };
    var origem = base ? base.itens : o.itens;
    (origem || []).forEach(function (it) { rx.itens.push({ nome: it.nome || '', pos: it.pos || '', qtd: it.qtd || '', qtdExtenso: it.qtdExtenso || '', classe: classificar(it.nome, it.c) }); });
    var corpo = document.createElement('div');
    corpo.className = 'rx-editor pilha';
    var rodape = document.createElement('div');
    rodape.className = 'linha-acoes';
    rodape.innerHTML = '<button type="button" class="btn btn-neutro" data-fecha="1">Cancelar</button><button type="button" class="btn btn-neutro" data-acao="salvar">Salvar</button><button type="button" class="btn btn-primario" data-acao="salvar-imprimir"><i class="ti ti-printer" aria-hidden="true"></i>Salvar e imprimir</button>';
    var d = CL.ui.drawer({ titulo: base ? 'Nova receita a partir da anterior' : 'Receituário', corpo: corpo, rodape: rodape, largura: 'lg' });

    function render() {
      corpo.innerHTML = '<div class="campos">' +
        campo('Tipo', '<select class="select" data-campo="tipo">' + opcoes([['simples', 'Receituário simples'], ['antimicrobiano', 'Antimicrobiano (2 vias)'], ['controle', 'Controle especial (2 vias)']], rx.tipo) + '</select>') +
        campo('Modelos', selectModelos('rx')) + '</div>' +
        '<div class="campo rx-busca-wrap"><label class="campo-rotulo" for="rx-busca">Adicionar medicamento</label><div class="busca"><i class="ti ti-search" aria-hidden="true"></i><input id="rx-busca" class="input" type="text" data-campo="busca" autocomplete="off" placeholder="Nome (ex.: amoxicilina, losartana) — Enter adiciona"></div><div class="rx-sug" role="listbox" hidden></div></div>' +
        '<div class="rx-itens" data-lista></div>' +
        '<div class="aviso-inline is-erro" data-alergia hidden></div>' +
        campo('Orientações (opcional)', '<textarea class="textarea" data-campo="obs" rows="2" placeholder="Ex.: retorno em 7 dias, repouso">' + e(rx.obs) + '</textarea>') +
        '<div class="linha-acoes"><button type="button" class="btn btn-neutro btn-pequeno" data-acao="imprimir-rascunho"><i class="ti ti-printer" aria-hidden="true"></i>Imprimir rascunho</button>' +
        (p.fone ? '<button type="button" class="btn btn-neutro btn-pequeno" data-acao="whatsapp"><i class="ti ti-brand-whatsapp" aria-hidden="true"></i>Enviar texto por WhatsApp</button>' : '') + '</div>';
      renderItens();
      CL.util.semAutofill(corpo.querySelector('[data-campo="busca"]'));
    }
    function renderItens() {
      var box = corpo.querySelector('[data-lista]');
      if (!rx.itens.length) { box.innerHTML = '<p class="texto-3 rx-vazio">Nenhum medicamento. Busque acima e selecione — a posologia vem pronta.</p>'; renderAlergia(); return; }
      box.innerHTML = rx.itens.map(function (it, i) {
        var cl = it.classe || 'simples';
        var precisaExt = cl === 'controle' || cl === 'ab' || rx.tipo === 'controle';
        var hit = alergiaHit(p, it.nome);
        return '<div class="rx-item" data-i="' + i + '"><div class="rx-item-cabeca"><span class="rx-num">' + (i + 1) + '</span>' +
          '<input class="input" type="text" data-campo="nome" autocomplete="off" placeholder="Medicamento e apresentação" value="' + e(it.nome) + '">' +
          '<button type="button" class="btn btn-icone btn-fantasma" data-acao="remover-item" aria-label="Remover item"><i class="ti ti-x" aria-hidden="true"></i></button></div>' +
          '<textarea class="textarea rx-pos" data-campo="pos" rows="2" placeholder="Posologia: via, dose, frequência, duração">' + e(it.pos) + '</textarea>' +
          '<div class="rx-qtd"><input class="input" type="text" data-campo="qtd" autocomplete="off" placeholder="Quantidade (ex.: 30 comprimidos)" value="' + e(it.qtd) + '">' +
          '<input class="input" type="text" data-campo="qtdExtenso" autocomplete="off" placeholder="' + (precisaExt ? 'Por extenso (obrigatório)' : 'Por extenso (opcional)') + '" value="' + e(it.qtdExtenso) + '"></div>' +
          '<div class="rx-tags">' + (cl === 'controle' ? chipTipo('controle especial', 'chip-aviso') : cl === 'ab' ? chipTipo('notificação de receita', 'chip-erro') : cl === 'antimicrobiano' ? chipTipo('antimicrobiano', 'chip-acento') : '') +
          (hit ? '<span class="chip chip-erro"><i class="ti ti-alert-triangle" aria-hidden="true"></i>alergia registrada: ' + e(hit) + '</span>' : '') + '</div></div>';
      }).join('');
      renderAlergia();
    }
    function renderAlergia() {
      var av = corpo.querySelector('[data-alergia]');
      var hits = rx.itens.filter(function (it) { return alergiaHit(p, it.nome); });
      if (!hits.length) { av.hidden = true; av.innerHTML = ''; return; }
      av.hidden = false;
      av.innerHTML = '<i class="ti ti-alert-triangle" aria-hidden="true"></i><div><strong>Alergia registrada:</strong> ' + e(p.alergias) + '<br>Itens com correspondência: ' + hits.map(function (it) { return e(it.nome); }).join(', ') +
        '<label class="campo-linha"><input type="checkbox" data-campo="alergiaOk"' + (rx.alergiaOk ? ' checked' : '') + '><span>Conferi a alergia e mantenho a prescrição</span></label></div>';
    }
    function ajustarTipo(classe) {
      if (rx.tipo !== 'simples') return;
      if (classe === 'controle' || classe === 'ab') { rx.tipo = 'controle'; CL.ui.toast('Tipo alterado para controle especial', { kind: 'info' }); }
      else if (classe === 'antimicrobiano') { rx.tipo = 'antimicrobiano'; CL.ui.toast('Tipo alterado para antimicrobiano (2 vias)', { kind: 'info' }); }
      var sel = corpo.querySelector('[data-campo="tipo"]'); if (sel) sel.value = rx.tipo;
    }
    function adicionar(nome, pos, c) {
      var it = { nome: nome, pos: pos || '', qtd: '', qtdExtenso: '', classe: classificar(nome, c) };
      rx.itens.push(it);
      ajustarTipo(it.classe);
      renderItens();
      var busca = corpo.querySelector('[data-campo="busca"]');
      busca.value = ''; esconderSug(); busca.focus();
    }
    function esconderSug() { var s = corpo.querySelector('.rx-sug'); s.hidden = true; s.innerHTML = ''; }
    function sugerir(q) {
      var s = corpo.querySelector('.rx-sug');
      var res = buscarMed(q);
      var texto = String(q || '').trim();
      if (!texto || texto.length < 2) { esconderSug(); return; }
      s.innerHTML = res.map(function (m, i) {
        return '<button type="button" class="rx-sug-item" role="option" data-sug="' + i + '"><span><strong>' + e(m.n) + '</strong>' + (m.classe === 'controle' || m.classe === 'ab' ? ' <span class="chip chip-aviso">controlado</span>' : m.classe === 'antimicrobiano' ? ' <span class="chip chip-acento">antimicrobiano</span>' : '') + '</span><small>' + e(m.p) + '</small></button>';
      }).join('') + '<button type="button" class="rx-sug-item is-manual" role="option" data-manual="1"><span><i class="ti ti-plus" aria-hidden="true"></i> Adicionar "' + e(texto) + '" manualmente</span></button>';
      s.hidden = false;
      s._res = res;
    }
    corpo.addEventListener('input', function (ev) {
      var el = ev.target;
      var campoNome = el.getAttribute('data-campo');
      if (campoNome === 'busca') { sugerir(el.value); return; }
      if (campoNome === 'obs') { rx.obs = el.value; return; }
      if (campoNome === 'tipo') return;
      var itemEl = el.closest('[data-i]');
      if (!itemEl) return;
      var it = rx.itens[+itemEl.getAttribute('data-i')];
      if (!it) return;
      it[campoNome] = el.value;
      if (campoNome === 'nome') {
        it.classe = classificar(el.value);
        ajustarTipo(it.classe);
        var tags = itemEl.querySelector('.rx-tags');
        var hit = alergiaHit(p, el.value);
        tags.innerHTML = (it.classe === 'controle' ? chipTipo('controle especial', 'chip-aviso') : it.classe === 'ab' ? chipTipo('notificação de receita', 'chip-erro') : it.classe === 'antimicrobiano' ? chipTipo('antimicrobiano', 'chip-acento') : '') + (hit ? '<span class="chip chip-erro"><i class="ti ti-alert-triangle" aria-hidden="true"></i>alergia registrada: ' + e(hit) + '</span>' : '');
        renderAlergia();
      }
      if (campoNome === 'qtd') {
        var ext = itemEl.querySelector('[data-campo="qtdExtenso"]');
        if (ext && (!it.qtdExtenso || it._extAuto)) { it.qtdExtenso = extensoDeQtd(el.value); it._extAuto = true; ext.value = it.qtdExtenso; }
      }
      if (campoNome === 'qtdExtenso') it._extAuto = false;
    });
    corpo.addEventListener('change', function (ev) {
      var el = ev.target;
      var c = el.getAttribute('data-campo');
      if (c === 'tipo') { rx.tipo = el.value; renderItens(); }
      else if (c === 'alergiaOk') rx.alergiaOk = el.checked;
    });
    corpo.addEventListener('keydown', function (ev) {
      var el = ev.target;
      if (el.getAttribute('data-campo') === 'busca') {
        var s = corpo.querySelector('.rx-sug');
        if (ev.key === 'Enter') {
          ev.preventDefault();
          var res = (s && s._res) || [];
          if (res.length && !s.hidden) adicionar(res[0].n, res[0].p, res[0].c);
          else if (el.value.trim()) adicionar(el.value.trim(), '');
        } else if (ev.key === 'ArrowDown' && s && !s.hidden) { ev.preventDefault(); var b0 = s.querySelector('.rx-sug-item'); if (b0) b0.focus(); }
      } else if (el.classList.contains('rx-sug-item')) {
        var itens = Array.prototype.slice.call(corpo.querySelectorAll('.rx-sug-item'));
        var i = itens.indexOf(el);
        if (ev.key === 'ArrowDown') { ev.preventDefault(); (itens[i + 1] || itens[0]).focus(); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); if (i === 0) corpo.querySelector('[data-campo="busca"]').focus(); else itens[i - 1].focus(); }
      }
    });
    corpo.addEventListener('focusout', function (ev) {
      setTimeout(function () { if (!corpo.contains(document.activeElement) || !document.activeElement.closest('.rx-busca-wrap')) esconderSug(); }, 120);
    });
    corpo.addEventListener('click', function (ev) {
      var sug = ev.target.closest('[data-sug]');
      if (sug) { var m = corpo.querySelector('.rx-sug')._res[+sug.getAttribute('data-sug')]; if (m) adicionar(m.n, m.p, m.c); return; }
      if (ev.target.closest('[data-manual]')) { var b = corpo.querySelector('[data-campo="busca"]'); if (b.value.trim()) adicionar(b.value.trim(), ''); return; }
      var a = ev.target.closest('[data-acao]');
      if (!a) return;
      var acao = a.getAttribute('data-acao');
      if (acao === 'remover-item') { var itemEl = a.closest('[data-i]'); rx.itens.splice(+itemEl.getAttribute('data-i'), 1); renderItens(); }
      else if (acao === 'aplicar-modelo') {
        var sel = corpo.querySelector('[data-campo="modelo"]');
        var dados = sel && sel.value ? modelos.aplicar(sel.value) : null;
        if (!dados) { CL.ui.toast('Escolha um modelo', { kind: 'aviso' }); return; }
        rx.itens = (dados.itens || []).map(function (it) { return { nome: it.nome || '', pos: it.pos || '', qtd: it.qtd || '', qtdExtenso: it.qtdExtenso || '', classe: classificar(it.nome) }; });
        rx.tipo = dados.rxTipo === 'especial' ? 'controle' : (RX_TIPOS[dados.rxTipo] ? dados.rxTipo : 'simples');
        rx.obs = dados.obs || '';
        render();
      }
      else if (acao === 'salvar-modelo') {
        var lista = itensLimpos();
        if (!lista.length) { CL.ui.toast('Monte o receituário antes de salvar como modelo', { kind: 'aviso' }); return; }
        CL.ui.pedirTexto({ titulo: 'Salvar como modelo', rotulo: 'Nome do modelo', placeholder: 'Ex.: Receita HAS' }).then(function (nome) {
          if (!nome || !nome.trim()) return;
          modelos.salvar('rx', nome, { rxTipo: rx.tipo, itens: lista, obs: rx.obs });
          CL.ui.toast('Modelo salvo', { kind: 'ok' });
          var wrap = corpo.querySelector('.modelo-linha'); if (wrap) wrap.outerHTML = selectModelos('rx');
        });
      }
      else if (acao === 'imprimir-rascunho') {
        var lista2 = itensLimpos();
        if (!lista2.length) { CL.ui.toast('Adicione ao menos um medicamento', { kind: 'aviso' }); return; }
        imprimirReceita({ pacId: rx.pacId, profId: rx.profId, tipo: rx.tipo, itens: lista2, obs: rx.obs });
      }
      else if (acao === 'whatsapp') {
        var lista3 = itensLimpos();
        if (!lista3.length) { CL.ui.toast('Adicione ao menos um medicamento', { kind: 'aviso' }); return; }
        abrirWa(p.id, 'Olá, ' + CL.util.primeiroNome(p.nome) + '! Segue o seu receituário:\n\n' + textoReceita({ itens: lista3, obs: rx.obs }) + '\n\nA via impressa e assinada fica disponível na clínica.');
      }
    });
    function itensLimpos() {
      return rx.itens.map(function (it) { return { nome: String(it.nome || '').trim(), pos: String(it.pos || '').trim(), qtd: String(it.qtd || '').trim(), qtdExtenso: String(it.qtdExtenso || '').trim() }; }).filter(function (it) { return it.nome; });
    }
    function salvar(imprimir) {
      var lista = itensLimpos();
      if (!lista.length) { CL.ui.toast('Adicione ao menos um medicamento', { kind: 'aviso' }); corpo.querySelector('[data-campo="busca"]').focus(); return false; }
      var hits = lista.filter(function (it) { return alergiaHit(p, it.nome); });
      if (hits.length && !rx.alergiaOk) { CL.ui.toast('Confirme a conferência da alergia antes de salvar', { kind: 'erro' }); var av = corpo.querySelector('[data-alergia]'); if (av) { av.scrollIntoView({ block: 'center' }); var ck = av.querySelector('input'); if (ck) ck.focus(); } return false; }
      var grupos = separar(lista, rx.tipo);
      var semExtenso = grupos.controle.filter(function (it) { return !it.qtdExtenso; });
      if (semExtenso.length) {
        var corpoM = document.createElement('div');
        corpoM.className = 'prosa pilha';
        corpoM.innerHTML = '<p>A receita de controle especial exige a <strong>quantidade por extenso</strong> em cada medicamento. Falta em:</p><ul>' + semExtenso.map(function (it) { return '<li>' + e(it.nome) + '</li>'; }).join('') + '</ul><p>Preencha o campo "Por extenso" (ex.: 30 comprimidos — trinta comprimidos).</p>';
        CL.ui.modal({ titulo: 'Falta a quantidade por extenso', corpo: corpoM, botoes: [{ rotulo: 'Voltar ao receituário', tipo: 'primario' }] });
        return false;
      }
      var salvas = [];
      ['simples', 'antimicrobiano', 'controle'].forEach(function (g) {
        if (!grupos[g].length) return;
        salvas.push(CL.upsert('receitas', { pacId: rx.pacId, profId: rx.profId || null, consultaId: (o.consulta && o.consulta.id) || null, data: agoraISO(), tipo: g, itens: grupos[g].map(function (it) { return { nome: it.nome, pos: it.pos, qtd: it.qtd, qtdExtenso: it.qtdExtenso }; }), obs: rx.obs }));
      });
      if (salvas.length > 1) CL.ui.toast('Separado em ' + salvas.length + ' receituários: ' + salvas.map(function (r) { return RX_TIPOS[r.tipo].curto; }).join(' + '), { kind: 'info', ms: 6000 });
      else CL.ui.toast('Receita salva', { kind: 'ok' });
      if (typeof o.aoSalvar === 'function') { try { o.aoSalvar(salvas); } catch (err) { console.error(err); } }
      if (imprimir) {
        var ab = itensAB(salvas[0]);
        if (ab.length && salvas.length === 1) avisarNotificacao(ab);
        else {
          var prim = salvas.filter(function (r) { return !itensAB(r).length; })[0];
          if (prim) abrirPrevia(printReceita(prim));
          if (salvas.length > 1) CL.ui.toast('Imprima as demais pela aba Receitas', { kind: 'info' });
          if (!prim) avisarNotificacao(ab);
        }
      }
      return salvas;
    }
    rodape.querySelector('[data-acao="salvar"]').addEventListener('click', function () { if (salvar(false)) d.fechar({ motivo: 'salvar' }); });
    rodape.querySelector('[data-acao="salvar-imprimir"]').addEventListener('click', function () { if (salvar(true)) d.fechar({ motivo: 'salvar' }); });
    render();
    setTimeout(function () { var b = corpo.querySelector('[data-campo="busca"]'); if (b) b.focus(); }, 50);
    return d;
  }
  function verReceita(id) {
    var r = CL.get('receitas', id);
    if (!r || !podeAbrirProntuario()) return;
    var t = RX_TIPOS[r.tipo] || RX_TIPOS.simples;
    var corpo = document.createElement('div');
    corpo.className = 'pilha';
    corpo.innerHTML = '<div>' + chipTipo(t.curto, r.tipo === 'controle' ? 'chip-aviso' : r.tipo === 'antimicrobiano' ? 'chip-acento' : '') + ' <span class="texto-3 tnum">' + e(CL.fmt.dataHora(msDe(r.data, r.createdAt))) + '</span></div>' + preHtml(textoReceita(r));
    CL.ui.modal({
      titulo: t.rotulo, corpo: corpo, largo: true,
      botoes: [
        { rotulo: 'Nova a partir desta', tipo: 'neutro', icone: 'ti-copy', acao: function () { setTimeout(function () { abrirReceita({ pacId: r.pacId, id: id }); }, 0); } },
        { rotulo: 'Imprimir', tipo: 'neutro', icone: 'ti-printer', acao: function () { imprimirReceita(id); } },
        { rotulo: 'Fechar', tipo: 'primario' }
      ]
    });
  }

  /* =================== documentos: atestado =================== */
  var RE_CID = /\s*(?:CID(?:-?10)?\s*:?\s*[A-Z]\d{2}(?:\.\d{1,2})?\.?)/gi;
  var FRASE_CID = ' O(A) paciente autorizou a inclusão do diagnóstico (CID) neste documento.';
  function removerCid(texto) { return String(texto || '').replace(RE_CID, '').replace(FRASE_CID.trim(), '').replace(/\s{2,}/g, ' ').trim(); }
  function gerarTextoAtestado(c) {
    c = c || {};
    var p = pac(c.pacId) || {};
    var quem = 'o(a) paciente ' + (p.nome || '') + (p.cpf ? ', CPF ' + CL.fmt.cpf(p.cpf) : '');
    var dt = c.dataInicio ? CL.fmt.data(c.dataInicio) : CL.fmt.data(CL.util.hoje());
    var t;
    if (c.subtipo === 'comparecimento') {
      t = 'Atesto, para os devidos fins, que ' + quem + ' compareceu a atendimento nesta clínica em ' + dt + (c.horaIni ? ', no período das ' + c.horaIni + (c.horaFim ? ' às ' + c.horaFim : '') : '') + '.';
    } else if (c.subtipo === 'acompanhante') {
      t = 'Atesto, para os devidos fins, que ' + (c.acompanhante ? c.acompanhante : 'o(a) Sr(a). ____________________') + ' acompanhou ' + quem + ' em atendimento nesta clínica em ' + dt + (c.horaIni ? ', no período das ' + c.horaIni + (c.horaFim ? ' às ' + c.horaFim : '') : '') + '.';
    } else {
      var dias = Math.max(1, parseInt(c.dias, 10) || 1);
      t = 'Atesto, para os devidos fins, que ' + quem + ' esteve sob meus cuidados e necessita de afastamento de suas atividades por ' + dias + ' (' + numeroExtenso(dias) + ') dia' + (dias === 1 ? '' : 's') + ', a partir de ' + dt + '.';
    }
    if (c.incluirCid && c.cidAutorizado && c.cid) t += ' CID-10: ' + String(c.cid).trim().toUpperCase() + '.' + FRASE_CID;
    return t;
  }
  function printDocumento(dc) {
    var p = pac(dc.pacId);
    var titulo = dc.titulo || DOC_TIPOS[dc.tipo] || 'Documento';
    var texto = dc.tipo === 'atestado' && !dc.cidAutorizado ? removerCid(dc.texto) : dc.texto;
    var corpo;
    if (dc.tipo === 'exames') {
      var lista = String(dc.exames || dc.texto || '').split('\n').map(function (s) { return s.replace(/^[•\-\s]+/, '').trim(); }).filter(Boolean);
      corpo = '<ol>' + lista.map(function (x) { return '<li>' + e(x) + '</li>'; }).join('') + '</ol>' + (dc.ind ? '<p><strong>Indicação clínica:</strong> ' + e(dc.ind) + '</p>' : '');
    } else {
      corpo = '<pre class="doc-pre">' + e(texto) + '</pre>';
      if (dc.tipo === 'consentimento') corpo += DOC_CSS_EXTRA + '<div class="doc-assinaturas"><div class="doc-assinatura"><div class="doc-linha"></div><div>Paciente: ' + e(p ? p.nome : '') + '</div></div><div class="doc-assinatura"><div class="doc-linha"></div><div>Responsável legal (se aplicável)</div></div></div>';
    }
    if (dc.obs && dc.tipo !== 'exames') corpo += '<p>' + e(dc.obs) + '</p>';
    return { titulo: titulo, corpoHtml: corpo, paciente: p, profissional: profDe(dc.profId) || profissionalAtual(), tipoDoc: dc.tipo === 'exames' ? 'exames' : (dc.tipo === 'atestado' ? 'atestado' : 'documento'), mostrarCid: !!dc.cidAutorizado, documentoId: dc.id || null };
  }
  function imprimirDocumento(dOuId) {
    var dc = typeof dOuId === 'string' ? CL.get('documentos', dOuId) : dOuId;
    if (!dc) return Promise.resolve(false);
    abrirPrevia(printDocumento(dc));
    return Promise.resolve(true);
  }
  function salvarDocumento(dc) {
    var salvo = CL.upsert('documentos', Object.assign({ pacId: null, profId: profissionalAtual().id || null, data: agoraISO(), tipo: 'declaracao', subtipo: '', dias: null, dataInicio: '', horaIni: '', horaFim: '', cid: '', cidAutorizado: false, texto: '', titulo: '', exames: '', ind: '', obs: '', modeloId: null }, dc));
    if (salvo.tipo === 'atestado' && salvo.cidAutorizado && salvo.cid) {
      var p = pac(salvo.pacId);
      if (p) {
        var lista = Array.isArray(p.cidAutorizacoes) ? p.cidAutorizacoes.slice() : [];
        lista.push({ em: Date.now(), documentoId: salvo.id, cid: salvo.cid });
        CL.patch('pacientes', p.id, { cidAutorizacoes: lista });
      }
    }
    return salvo;
  }
  function abrirAtestado(o) {
    o = o || {};
    if (!podeAbrirProntuario()) return null;
    var p = pac(o.pacId);
    if (!p) { CL.ui.toast('Paciente não encontrado', { kind: 'erro' }); return null; }
    var base = o.id ? CL.get('documentos', o.id) : null;
    var at = { pacId: p.id, profId: (base && base.profId) || (o.consulta && o.consulta.profId) || profissionalAtual().id, subtipo: base ? (base.subtipo || 'afastamento') : 'afastamento', dias: base && base.dias ? base.dias : 1, dataInicio: base && base.dataInicio ? base.dataInicio : CL.util.hoje(), horaIni: base ? base.horaIni || '' : '', horaFim: base ? base.horaFim || '' : '', acompanhante: base ? base.acompanhante || '' : '', incluirCid: !!(base && base.cid), cidAutorizado: false, cid: base ? base.cid || '' : '', texto: base ? removerCid(base.texto) : '' };
    var corpo = document.createElement('div');
    corpo.className = 'pilha at-form';
    var rodape = document.createElement('div');
    rodape.className = 'linha-acoes';
    rodape.innerHTML = '<button type="button" class="btn btn-neutro" data-fecha="1">Cancelar</button><button type="button" class="btn btn-neutro" data-acao="imprimir">Imprimir</button><button type="button" class="btn btn-neutro" data-acao="salvar">Salvar</button><button type="button" class="btn btn-primario" data-acao="salvar-imprimir"><i class="ti ti-printer" aria-hidden="true"></i>Salvar e imprimir</button>';
    var d = CL.ui.drawer({ titulo: 'Atestado', corpo: corpo, rodape: rodape, largura: 'lg' });
    function render() {
      var afast = at.subtipo === 'afastamento';
      corpo.innerHTML = campo('Modelos', selectModelos('atestado')) +
        '<div class="campos">' +
        campo('Finalidade', '<select class="select" data-campo="subtipo">' + opcoes([['afastamento', 'Afastamento'], ['comparecimento', 'Comparecimento'], ['acompanhante', 'Acompanhante']], at.subtipo) + '</select>') +
        (afast ? campo('Dias de afastamento', '<input class="input" type="number" min="1" max="365" inputmode="numeric" data-campo="dias" value="' + e(at.dias) + '">') : '') +
        campo(afast ? 'A partir de' : 'Data', '<input class="input" type="date" data-campo="dataInicio" value="' + e(at.dataInicio) + '">') +
        (!afast ? campo('Das', '<input class="input" type="time" data-campo="horaIni" value="' + e(at.horaIni) + '">') + campo('Às', '<input class="input" type="time" data-campo="horaFim" value="' + e(at.horaFim) + '">') : '') +
        (at.subtipo === 'acompanhante' ? campo('Nome do acompanhante', '<input class="input" type="text" data-campo="acompanhante" autocomplete="off" value="' + e(at.acompanhante) + '">', 'campo-cheio') : '') +
        '</div>' +
        '<div class="at-cid"><label class="campo-linha"><input type="checkbox" data-campo="incluirCid"' + (at.incluirCid ? ' checked' : '') + '><span>Incluir CID no atestado</span></label>' +
        '<div class="at-cid-campos"' + (at.incluirCid ? '' : ' hidden') + '><div class="campos">' + campo('CID-10', '<input class="input" type="text" data-campo="cid" autocomplete="off" placeholder="Ex.: J11" value="' + e(at.cid) + '">') + '</div>' +
        '<label class="campo-linha"><input type="checkbox" data-campo="cidAutorizado"' + (at.cidAutorizado ? ' checked' : '') + '><span>Paciente autorizou constar o diagnóstico (CID)</span></label>' +
        '<p class="ajuda">O CID só sai impresso com a autorização marcada; a autorização fica registrada na ficha.</p></div></div>' +
        '<div class="campo"><div class="campo-rotulo-linha"><label class="campo-rotulo">Texto do atestado</label><button type="button" class="btn btn-fantasma btn-pequeno" data-acao="gerar"><i class="ti ti-refresh" aria-hidden="true"></i>Gerar a partir dos campos</button></div><textarea class="textarea" data-campo="texto" rows="7">' + e(at.texto) + '</textarea></div>';
      if (!at.texto) { at.texto = gerarTextoAtestado(at); corpo.querySelector('[data-campo="texto"]').value = at.texto; }
    }
    corpo.addEventListener('input', function (ev) {
      var c = ev.target.getAttribute('data-campo');
      if (!c || ev.target.type === 'checkbox') return;
      at[c] = ev.target.value;
      if (c !== 'texto') { at.texto = gerarTextoAtestado(at); corpo.querySelector('[data-campo="texto"]').value = at.texto; }
    });
    corpo.addEventListener('change', function (ev) {
      var c = ev.target.getAttribute('data-campo');
      if (c === 'subtipo') { at.subtipo = ev.target.value; at.texto = ''; render(); }
      else if (c === 'incluirCid') { at.incluirCid = ev.target.checked; corpo.querySelector('.at-cid-campos').hidden = !at.incluirCid; at.texto = gerarTextoAtestado(at); corpo.querySelector('[data-campo="texto"]').value = at.texto; }
      else if (c === 'cidAutorizado') { at.cidAutorizado = ev.target.checked; at.texto = gerarTextoAtestado(at); corpo.querySelector('[data-campo="texto"]').value = at.texto; }
    });
    corpo.addEventListener('click', function (ev) {
      var a = ev.target.closest('[data-acao]');
      if (!a) return;
      var acao = a.getAttribute('data-acao');
      if (acao === 'gerar') { at.texto = gerarTextoAtestado(at); corpo.querySelector('[data-campo="texto"]').value = at.texto; }
      else if (acao === 'aplicar-modelo') {
        var sel = corpo.querySelector('[data-campo="modelo"]');
        var m = sel && sel.value ? modelos.aplicar(sel.value) : null;
        if (!m) { CL.ui.toast('Escolha um modelo', { kind: 'aviso' }); return; }
        at.subtipo = m.subtipo || at.subtipo; if (m.dias) at.dias = m.dias; at.texto = m.texto || ''; at.cid = m.cid || ''; at.incluirCid = !!m.cid;
        render();
      }
      else if (acao === 'salvar-modelo') {
        if (!at.texto.trim()) { CL.ui.toast('Gere ou escreva o atestado antes de salvar como modelo', { kind: 'aviso' }); return; }
        CL.ui.pedirTexto({ titulo: 'Salvar como modelo', rotulo: 'Nome do modelo', placeholder: 'Ex.: Atestado 1 dia' }).then(function (nome) {
          if (!nome || !nome.trim()) return;
          modelos.salvar('atestado', nome, { subtipo: at.subtipo, dias: at.dias, cid: '', texto: removerCid(at.texto) });
          CL.ui.toast('Modelo salvo', { kind: 'ok' });
        });
      }
    });
    function coletar() {
      var cidOk = !!(at.incluirCid && at.cidAutorizado && String(at.cid).trim());
      var texto = String(at.texto || '').trim();
      if (!cidOk) texto = removerCid(texto);
      return { pacId: at.pacId, profId: at.profId, tipo: 'atestado', subtipo: at.subtipo, dias: at.subtipo === 'afastamento' ? (parseInt(at.dias, 10) || 1) : null, dataInicio: at.dataInicio, horaIni: at.horaIni, horaFim: at.horaFim, acompanhante: at.acompanhante, cid: cidOk ? String(at.cid).trim().toUpperCase() : '', cidAutorizado: cidOk, texto: texto, titulo: 'Atestado de ' + at.subtipo, consultaId: (o.consulta && o.consulta.id) || null };
    }
    function validar() {
      if (!String(at.texto || '').trim()) { CL.ui.toast('Gere ou escreva o texto do atestado', { kind: 'aviso' }); return false; }
      if (at.incluirCid && String(at.cid).trim() && !at.cidAutorizado) {
        var cm = document.createElement('div'); cm.className = 'prosa';
        cm.textContent = 'O CID só entra no atestado com a autorização do paciente. Marque "Paciente autorizou constar o diagnóstico" ou desligue "Incluir CID".';
        CL.ui.modal({ titulo: 'CID sem autorização', corpo: cm, botoes: [{ rotulo: 'Voltar', tipo: 'primario' }] });
        return false;
      }
      return true;
    }
    rodape.addEventListener('click', function (ev) {
      var a = ev.target.closest('[data-acao]');
      if (!a) return;
      var acao = a.getAttribute('data-acao');
      if (!validar()) return;
      var dc = coletar();
      if (acao === 'imprimir') { imprimirDocumento(dc); return; }
      var salvo = salvarDocumento(dc);
      CL.ui.toast('Atestado salvo', { kind: 'ok' });
      if (typeof o.aoSalvar === 'function') { try { o.aoSalvar(salvo); } catch (err) { console.error(err); } }
      if (acao === 'salvar-imprimir') imprimirDocumento(salvo);
      d.fechar({ motivo: 'salvar' });
    });
    render();
    return d;
  }

  /* =================== documentos: pedido de exames =================== */
  function abrirExames(o) {
    o = o || {};
    if (!podeAbrirProntuario()) return null;
    var p = pac(o.pacId);
    if (!p) { CL.ui.toast('Paciente não encontrado', { kind: 'erro' }); return null; }
    var base = o.id ? CL.get('documentos', o.id) : null;
    var ex = { pacId: p.id, profId: (base && base.profId) || (o.consulta && o.consulta.profId) || profissionalAtual().id, lista: base ? (base.exames || '') : '', ind: base ? (base.ind || '') : '' };
    var corpo = document.createElement('div');
    corpo.className = 'pilha';
    var rodape = document.createElement('div');
    rodape.className = 'linha-acoes';
    rodape.innerHTML = '<button type="button" class="btn btn-neutro" data-fecha="1">Cancelar</button><button type="button" class="btn btn-neutro" data-acao="imprimir">Imprimir</button><button type="button" class="btn btn-neutro" data-acao="salvar">Salvar</button><button type="button" class="btn btn-primario" data-acao="salvar-imprimir"><i class="ti ti-printer" aria-hidden="true"></i>Salvar e imprimir</button>';
    var d = CL.ui.drawer({ titulo: 'Pedido de exames', corpo: corpo, rodape: rodape, largura: 'lg' });
    function linhas() { return ex.lista.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); }
    function render() {
      var atuais = linhas().map(function (s) { return CL.util.norm(s); });
      corpo.innerHTML = campo('Modelos', selectModelos('exames')) +
        '<div class="campo"><label class="campo-rotulo">Exames mais pedidos</label><div class="ex-chips">' + EXAMES_COMUNS.map(function (x) { var on = atuais.indexOf(CL.util.norm(x)) >= 0; return '<button type="button" class="chip-btn" data-exame="' + e(x) + '" aria-pressed="' + (on ? 'true' : 'false') + '"><i class="ti ' + (on ? 'ti-check' : 'ti-plus') + '" aria-hidden="true"></i>' + e(x) + '</button>'; }).join('') + '</div></div>' +
        campo('Exames solicitados (um por linha)', '<textarea class="textarea" data-campo="lista" rows="8" placeholder="Hemograma completo&#10;Glicemia de jejum&#10;TSH">' + e(ex.lista) + '</textarea>') +
        campo('Indicação clínica (opcional)', '<textarea class="textarea" data-campo="ind" rows="2" placeholder="Ex.: investigação de fadiga; HAS em acompanhamento">' + e(ex.ind) + '</textarea>');
    }
    corpo.addEventListener('input', function (ev) { var c = ev.target.getAttribute('data-campo'); if (c === 'lista' || c === 'ind') ex[c] = ev.target.value; });
    corpo.addEventListener('click', function (ev) {
      var ch = ev.target.closest('[data-exame]');
      if (ch) {
        var nome = ch.getAttribute('data-exame');
        var l = linhas();
        var i = l.map(function (s) { return CL.util.norm(s); }).indexOf(CL.util.norm(nome));
        if (i >= 0) l.splice(i, 1); else l.push(nome);
        ex.lista = l.join('\n');
        var foco = ch.getAttribute('data-exame');
        render();
        var novo = corpo.querySelector('[data-exame="' + foco.replace(/"/g, '&quot;') + '"]'); if (novo) novo.focus();
        return;
      }
      var a = ev.target.closest('[data-acao]');
      if (!a) return;
      var acao = a.getAttribute('data-acao');
      if (acao === 'aplicar-modelo') {
        var sel = corpo.querySelector('[data-campo="modelo"]');
        var m = sel && sel.value ? modelos.aplicar(sel.value) : null;
        if (!m) { CL.ui.toast('Escolha um modelo', { kind: 'aviso' }); return; }
        ex.lista = m.lista || ''; render();
      } else if (acao === 'salvar-modelo') {
        if (!linhas().length) { CL.ui.toast('Liste ao menos um exame', { kind: 'aviso' }); return; }
        CL.ui.pedirTexto({ titulo: 'Salvar como modelo', rotulo: 'Nome do modelo', placeholder: 'Ex.: Rotina anual' }).then(function (nome) {
          if (!nome || !nome.trim()) return;
          modelos.salvar('exames', nome, { lista: ex.lista });
          CL.ui.toast('Modelo salvo', { kind: 'ok' });
        });
      }
    });
    function coletar() {
      var l = linhas();
      return { pacId: ex.pacId, profId: ex.profId, tipo: 'exames', exames: l.join('\n'), ind: ex.ind.trim(), texto: l.map(function (s) { return '• ' + s; }).join('\n'), obs: ex.ind.trim() ? 'Indicação clínica: ' + ex.ind.trim() : '', titulo: 'Solicitação de exames', consultaId: (o.consulta && o.consulta.id) || null };
    }
    rodape.addEventListener('click', function (ev) {
      var a = ev.target.closest('[data-acao]');
      if (!a) return;
      if (!linhas().length) { CL.ui.toast('Liste ao menos um exame', { kind: 'aviso' }); return; }
      var acao = a.getAttribute('data-acao');
      var dc = coletar();
      if (acao === 'imprimir') { imprimirDocumento(dc); return; }
      var salvo = salvarDocumento(dc);
      CL.ui.toast('Pedido de exames salvo', { kind: 'ok' });
      if (typeof o.aoSalvar === 'function') { try { o.aoSalvar(salvo); } catch (err) { console.error(err); } }
      if (acao === 'salvar-imprimir') imprimirDocumento(salvo);
      d.fechar({ motivo: 'salvar' });
    });
    render();
    return d;
  }

  /* =================== documentos por modelo =================== */
  function preencher(texto, pacId, extras) {
    var p = pac(pacId) || {};
    var prof = profissionalAtual();
    var cl = (CL.state.cfg && CL.state.cfg.clinica) || {};
    extras = extras || {};
    var mapa = {
      nome: p.nome || '', cpf: p.cpf ? CL.fmt.cpf(p.cpf) : '[CPF não informado]', data: CL.fmt.data(CL.util.hoje()), nasc: p.nasc ? CL.fmt.data(p.nasc) : '[nascimento não informado]',
      idade: CL.fmt.idade(p.nasc) || '[idade não informada]', prof: prof.nome || '', clinica: cl.nome || '', endereco: p.endereco || '[endereço não informado]'
    };
    Object.keys(extras).forEach(function (k) { mapa[k] = extras[k]; });
    return String(texto || '').replace(/\{\{\s*(\w+)\s*\}\}/g, function (m, k) { return (k in mapa && String(mapa[k]).trim()) ? String(mapa[k]) : '[' + k + ' não informado]'; });
  }
  function abrirDocumento(o) {
    o = o || {};
    if (!podeAbrirProntuario()) return null;
    var p = pac(o.pacId);
    if (!p) { CL.ui.toast('Paciente não encontrado', { kind: 'erro' }); return null; }
    var base = o.id ? CL.get('documentos', o.id) : null;
    var tipoIni = base ? base.tipo : (DOC_MODELOS[o.tipo] ? o.tipo : 'declaracao');
    var dc = { pacId: p.id, profId: (base && base.profId) || (o.consulta && o.consulta.profId) || profissionalAtual().id, tipo: tipoIni, titulo: base ? base.titulo : DOC_TIPOS[tipoIni], texto: base ? base.texto : DOC_MODELOS[tipoIni], modeloId: base ? base.modeloId : (o.modeloId || null), procedimento: '', riscos: '', destino: '' };
    if (!base && o.modeloId) { var m0 = modelos.aplicar(o.modeloId); if (m0) { dc.texto = m0.texto || dc.texto; dc.titulo = m0.titulo || dc.titulo; } }
    var corpo = document.createElement('div');
    corpo.className = 'pilha';
    var rodape = document.createElement('div');
    rodape.className = 'linha-acoes';
    rodape.innerHTML = '<button type="button" class="btn btn-neutro" data-fecha="1">Cancelar</button><button type="button" class="btn btn-neutro" data-acao="imprimir">Imprimir</button><button type="button" class="btn btn-neutro" data-acao="salvar">Salvar</button><button type="button" class="btn btn-primario" data-acao="salvar-imprimir"><i class="ti ti-printer" aria-hidden="true"></i>Salvar e imprimir</button>';
    var d = CL.ui.drawer({ titulo: 'Documento', corpo: corpo, rodape: rodape, largura: 'lg' });
    function render() {
      corpo.innerHTML = '<div class="campos">' +
        campo('Tipo', '<select class="select" data-campo="tipo">' + opcoes(Object.keys(DOC_MODELOS).map(function (k) { return [k, DOC_TIPOS[k]]; }), dc.tipo) + '</select>') +
        campo('Modelos', selectModelos('documento', function (m) { return !m.documento || !m.documento.tipoDoc || m.documento.tipoDoc === dc.tipo; })) +
        campo('Título', '<input class="input" type="text" data-campo="titulo" autocomplete="off" value="' + e(dc.titulo) + '">', 'campo-cheio') +
        (dc.tipo === 'consentimento' ? campo('Procedimento', '<input class="input" type="text" data-campo="procedimento" autocomplete="off" value="' + e(dc.procedimento) + '">') + campo('Riscos informados', '<input class="input" type="text" data-campo="riscos" autocomplete="off" placeholder="Ex.: dor, sangramento, infecção" value="' + e(dc.riscos) + '">') : '') +
        (dc.tipo === 'encaminhamento' ? campo('Especialidade / destino', '<input class="input" type="text" data-campo="destino" autocomplete="off" value="' + e(dc.destino) + '">') : '') +
        '</div>' +
        '<div class="campo"><div class="campo-rotulo-linha"><label class="campo-rotulo">Texto</label><button type="button" class="btn btn-fantasma btn-pequeno" data-acao="preencher"><i class="ti ti-replace" aria-hidden="true"></i>Preencher campos</button></div>' +
        '<textarea class="textarea" data-campo="texto" rows="12">' + e(dc.texto) + '</textarea><p class="ajuda">Marcadores: {{nome}} {{cpf}} {{data}} {{nasc}} {{idade}} {{prof}} {{clinica}}' + (dc.tipo === 'consentimento' ? ' {{procedimento}} {{riscos}}' : dc.tipo === 'encaminhamento' ? ' {{destino}}' : '') + ' — são substituídos ao salvar/imprimir.</p></div>';
    }
    corpo.addEventListener('input', function (ev) { var c = ev.target.getAttribute('data-campo'); if (c && c !== 'tipo' && c !== 'modelo') dc[c] = ev.target.value; });
    corpo.addEventListener('change', function (ev) {
      if (ev.target.getAttribute('data-campo') === 'tipo') { dc.tipo = ev.target.value; dc.titulo = DOC_TIPOS[dc.tipo]; dc.texto = DOC_MODELOS[dc.tipo]; render(); }
    });
    corpo.addEventListener('click', function (ev) {
      var a = ev.target.closest('[data-acao]');
      if (!a) return;
      var acao = a.getAttribute('data-acao');
      if (acao === 'preencher') { dc.texto = preencher(dc.texto, p.id, { procedimento: dc.procedimento, riscos: dc.riscos, destino: dc.destino }); corpo.querySelector('[data-campo="texto"]').value = dc.texto; }
      else if (acao === 'aplicar-modelo') {
        var sel = corpo.querySelector('[data-campo="modelo"]');
        var m = sel && sel.value ? modelos.aplicar(sel.value) : null;
        if (!m) { CL.ui.toast('Escolha um modelo', { kind: 'aviso' }); return; }
        dc.texto = m.texto || ''; dc.titulo = m.titulo || dc.titulo; dc.modeloId = sel.value; render();
      } else if (acao === 'salvar-modelo') {
        if (!dc.texto.trim()) { CL.ui.toast('Escreva o texto antes de salvar como modelo', { kind: 'aviso' }); return; }
        CL.ui.pedirTexto({ titulo: 'Salvar como modelo', rotulo: 'Nome do modelo' }).then(function (nome) {
          if (!nome || !nome.trim()) return;
          modelos.salvar('documento', nome, { tipoDoc: dc.tipo, titulo: dc.titulo, texto: dc.texto });
          CL.ui.toast('Modelo salvo', { kind: 'ok' });
        });
      }
    });
    function coletar() {
      return { pacId: dc.pacId, profId: dc.profId, tipo: dc.tipo, titulo: dc.titulo.trim() || DOC_TIPOS[dc.tipo], texto: preencher(dc.texto, p.id, { procedimento: dc.procedimento, riscos: dc.riscos, destino: dc.destino }).trim(), modeloId: dc.modeloId, consultaId: (o.consulta && o.consulta.id) || null };
    }
    rodape.addEventListener('click', function (ev) {
      var a = ev.target.closest('[data-acao]');
      if (!a) return;
      if (!dc.texto.trim()) { CL.ui.toast('Escreva o texto do documento', { kind: 'aviso' }); return; }
      var acao = a.getAttribute('data-acao');
      var doc = coletar();
      if (acao === 'imprimir') { imprimirDocumento(doc); return; }
      var salvo = salvarDocumento(doc);
      CL.ui.toast(DOC_TIPOS[salvo.tipo] + ' salvo(a)', { kind: 'ok' });
      if (typeof o.aoSalvar === 'function') { try { o.aoSalvar(salvo); } catch (err) { console.error(err); } }
      if (acao === 'salvar-imprimir') imprimirDocumento(salvo);
      d.fechar({ motivo: 'salvar' });
    });
    render();
    return d;
  }
  function verDocumento(id) {
    var dc = CL.get('documentos', id);
    if (!dc || !podeAbrirProntuario()) return;
    var corpo = document.createElement('div');
    corpo.className = 'pilha';
    corpo.innerHTML = '<div>' + chipTipo(DOC_TIPOS[dc.tipo] || dc.tipo, 'chip-acento') + ' <span class="texto-3 tnum">' + e(CL.fmt.dataHora(msDe(dc.data, dc.createdAt))) + '</span>' + (dc.tipo === 'atestado' ? ' ' + (dc.cidAutorizado ? chipTipo('CID autorizado', 'chip-ok') : chipTipo('sem CID')) : '') + '</div>' + preHtml(dc.tipo === 'atestado' && !dc.cidAutorizado ? removerCid(dc.texto) : dc.texto) + (dc.obs ? '<p class="texto-2">' + e(dc.obs) + '</p>' : '');
    var abrirNovo = dc.tipo === 'atestado' ? abrirAtestado : dc.tipo === 'exames' ? abrirExames : abrirDocumento;
    var p = pac(dc.pacId);
    CL.ui.modal({
      titulo: dc.titulo || DOC_TIPOS[dc.tipo] || 'Documento', corpo: corpo, largo: true,
      botoes: [
        { rotulo: 'Novo a partir deste', tipo: 'neutro', icone: 'ti-copy', acao: function () { setTimeout(function () { abrirNovo({ pacId: dc.pacId, id: id }); }, 0); } },
        (p && p.fone) ? { rotulo: 'WhatsApp', tipo: 'neutro', icone: 'ti-brand-whatsapp', fecha: false, acao: function () { abrirWa(dc.pacId, 'Olá, ' + CL.util.primeiroNome(p.nome) + '! Segue ' + (dc.tipo === 'atestado' ? 'o seu atestado' : dc.tipo === 'exames' ? 'o seu pedido de exames' : 'o documento') + ':\n\n' + (dc.tipo === 'atestado' ? removerCid(dc.texto) : dc.texto) + '\n\nA via impressa e assinada fica disponível na clínica.'); } } : null,
        { rotulo: 'Imprimir', tipo: 'neutro', icone: 'ti-printer', acao: function () { imprimirDocumento(id); } },
        { rotulo: 'Fechar', tipo: 'primario' }
      ].filter(Boolean)
    });
  }

  /* =================== exames laboratoriais (labs) =================== */
  function svgSerie(serie) {
    serie = (serie || []).slice().sort(function (a, b) { return String(a.data).localeCompare(String(b.data)); });
    var n = serie.length;
    if (!n) return '';
    var W = 600, H = 170, padL = 10, padR = 10, padT = 22, padB = 26;
    var ys = serie.map(function (s) { return Number(s.valor) || 0; });
    var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
    if (lo === hi) { lo -= 1; hi += 1; }
    var pd = (hi - lo) * 0.18; lo -= pd; hi += pd;
    var span = (hi - lo) || 1, plotW = W - padL - padR, plotH = H - padT - padB;
    var X = function (i) { return padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW); };
    var Y = function (v) { return padT + (1 - (v - lo) / span) * plotH; };
    var linha = serie.map(function (s, i) { return X(i).toFixed(1) + ',' + Y(Number(s.valor) || 0).toFixed(1); }).join(' ');
    var passo = Math.max(1, Math.ceil(n / 6)), marcas = '';
    serie.forEach(function (s, i) {
      var x = X(i).toFixed(1), y = Y(Number(s.valor) || 0);
      marcas += '<circle cx="' + x + '" cy="' + y.toFixed(1) + '" r="3.5" fill="#2B5CE6"/>';
      marcas += '<text x="' + x + '" y="' + (y - 7).toFixed(1) + '" font-size="10" text-anchor="middle" fill="#23272E">' + e(String(Math.round(Number(s.valor) * 100) / 100).replace('.', ',')) + '</text>';
      if (i % passo === 0 || i === n - 1) marcas += '<text x="' + x + '" y="' + (H - 8) + '" font-size="9" text-anchor="middle" fill="#4B515A">' + e(CL.fmt.data(s.data).slice(0, 5)) + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Curva de ' + n + ' valores" preserveAspectRatio="xMidYMid meet"><polyline points="' + linha + '" fill="none" stroke="#2B5CE6" stroke-width="2"/>' + marcas + '</svg>';
  }
  var labs = {
    adicionar: function (d) {
      d = d || {};
      var nome = String(d.nome || '').trim();
      var valor = parseFloat(String(d.valor == null ? '' : d.valor).replace(',', '.'));
      if (!nome) throw new Error('Informe o nome do exame');
      if (isNaN(valor)) throw new Error('Informe um valor numérico');
      return CL.upsert('exames', { pacId: d.pacId, data: d.data || CL.util.hoje(), nome: nome, valor: valor, unidade: String(d.unidade || '').trim() });
    },
    remover: function (id) {
      if (!(CL.session && CL.session.perfil === 'admin')) { CL.ui.toast('Só o administrador remove um valor de exame', { kind: 'aviso' }); return Promise.resolve(false); }
      return CL.ui.confirmar({ titulo: 'Remover valor', texto: 'O valor sai da curva. Esta ação fica registrada.', ok: 'Remover', okTipo: 'perigo' }).then(function (ok) {
        if (!ok) return false;
        var x = CL.get('exames', id);
        CL.remove('exames', id);
        CL.audit('exame.remover', 'exames', id, { pacId: x ? x.pacId : null });
        return true;
      });
    },
    svg: svgSerie,
    grupos: function (pacId) {
      var mapa = {}, ordem = [];
      CL.col('exames').filter(function (x) { return x && x.pacId === pacId; }).sort(function (a, b) { return String(a.data).localeCompare(String(b.data)); }).forEach(function (x) {
        var k = CL.util.norm(x.nome);
        if (!mapa[k]) { mapa[k] = { nome: x.nome, unidade: x.unidade || '', serie: [] }; ordem.push(k); }
        mapa[k].serie.push(x);
        if (x.unidade) mapa[k].unidade = x.unidade;
      });
      return ordem.map(function (k) {
        var g = mapa[k], n = g.serie.length;
        var ult = g.serie[n - 1], ant = n > 1 ? g.serie[n - 2] : null;
        g.ultimo = ult; g.tendencia = ant ? (ult.valor > ant.valor ? 'sobe' : ult.valor < ant.valor ? 'desce' : 'igual') : '';
        return g;
      }).sort(function (a, b) { return String(b.ultimo.data).localeCompare(String(a.ultimo.data)); });
    }
  };
  function fmtValor(v) { return String(Math.round(Number(v) * 100) / 100).replace('.', ','); }
  function iconeTend(t) { return t === 'sobe' ? '<i class="ti ti-trending-up" aria-label="subiu"></i>' : t === 'desce' ? '<i class="ti ti-trending-down" aria-label="desceu"></i>' : t === 'igual' ? '<i class="ti ti-minus" aria-label="estável"></i>' : ''; }
  function renderLabs(box, pacId) {
    var grupos = labs.grupos(pacId);
    var admin = CL.session && CL.session.perfil === 'admin';
    var nomes = {};
    ANALITOS_COMUNS.concat(grupos.map(function (g) { return g.nome; })).forEach(function (n) { nomes[n] = 1; });
    var h = '<form class="card lab-form" data-lab-form novalidate><div class="card-titulo"><i class="ti ti-flask" aria-hidden="true"></i>Registrar resultado</div><div class="campos">' +
      campo('Exame', '<input class="input" type="text" name="nome" list="lab-analitos" autocomplete="off" placeholder="Ex.: Creatinina" required><datalist id="lab-analitos">' + Object.keys(nomes).map(function (n) { return '<option value="' + e(n) + '">'; }).join('') + '</datalist>') +
      campo('Valor', '<input class="input" type="text" name="valor" inputmode="decimal" autocomplete="off" placeholder="Ex.: 1,2" required>') +
      campo('Unidade', '<input class="input" type="text" name="unidade" autocomplete="off" placeholder="mg/dL">') +
      campo('Data', '<input class="input" type="date" name="data" value="' + CL.util.hoje() + '">') +
      '</div><div class="linha-acoes" style="margin-top:12px"><button type="submit" class="btn btn-primario"><i class="ti ti-plus" aria-hidden="true"></i>Adicionar</button>' + botao('novo-exames', 'Pedido de exames', 'ti-file-text') + '</div></form>';
    if (!grupos.length) {
      box.innerHTML = h;
      var v = document.createElement('div'); box.appendChild(v);
      CL.ui.vazio(v, { icone: 'ti-chart-line', titulo: 'Nenhum resultado registrado', texto: 'Registre valores de exames para acompanhar a curva ao longo do tempo.' });
      return;
    }
    h += '<div class="lab-grupos">' + grupos.map(function (g) {
      return '<div class="card lab-grupo"><div class="lab-cabeca"><div><strong>' + e(g.nome) + '</strong> <span class="texto-3">' + e(g.unidade) + '</span></div><div class="lab-ultimo tnum">' + e(fmtValor(g.ultimo.valor)) + ' ' + e(g.unidade) + ' ' + iconeTend(g.tendencia) + '<small class="texto-3"> em ' + e(CL.fmt.data(g.ultimo.data)) + '</small></div></div>' +
        (g.serie.length >= 2 ? '<div class="lab-curva">' + svgSerie(g.serie) + '</div>' : '') +
        '<details class="lab-valores"><summary>' + g.serie.length + ' valor(es)</summary><ul class="lista-simples">' + g.serie.slice().reverse().map(function (x) { return '<li><span class="tnum">' + e(CL.fmt.data(x.data)) + '</span><span style="flex:1" class="tnum">' + e(fmtValor(x.valor)) + ' ' + e(x.unidade || '') + '</span>' + (admin ? '<button type="button" class="btn btn-icone btn-fantasma" data-acao="remover-lab" data-id="' + e(x.id) + '" aria-label="Remover valor"><i class="ti ti-trash" aria-hidden="true"></i></button>' : '') + '</li>'; }).join('') + '</ul></details></div>';
    }).join('') + '</div>';
    box.innerHTML = h;
  }

  /* =================== abas clínicas da ficha =================== */
  function cartaoEvolucao(r, compacto) {
    var f = REC_FMT[r.tipo] || REC_FMT.evolucao;
    var ret = Array.isArray(r.versoes) && r.versoes.length ? '<span class="chip chip-aviso" title="Versão anterior guardada"><i class="ti ti-history" aria-hidden="true"></i>retificado em ' + e(CL.fmt.dataHora(r.retificadoEm || r.updatedAt)) + ' (' + r.versoes.length + ' versão' + (r.versoes.length > 1 ? 'ões' : '') + ')</span>' : '';
    return '<article class="hist-item" data-tipo="evolucao" data-id="' + e(r.id) + '"><div class="hist-cabeca"><div class="hist-meta">' + chipTipo(f.l, 'chip-acento') + (r.tipoAtend && ATEND_TIPOS[r.tipoAtend] ? chipTipo(ATEND_TIPOS[r.tipoAtend]) : '') + (r.origem === 'ia_audio' || r.origem === 'ia_texto' ? chipTipo('com IA') : '') + ret + '</div><span class="texto-3 tnum">' + e(CL.fmt.dataHora(msDe(r.data, r.createdAt))) + '</span></div>' +
      '<h3 class="hist-titulo">' + e(r.titulo || f.l) + '</h3><div class="hist-texto' + (compacto ? ' is-3' : '') + '">' + e(r.texto) + '</div>' +
      '<div class="hist-acoes">' + botao('ver-evolucao', 'Abrir', 'ti-eye', 'btn-neutro btn-pequeno', ' data-id="' + e(r.id) + '"') + (compacto ? '' : botao('editar-evolucao', 'Editar', 'ti-pencil', 'btn-fantasma btn-pequeno', ' data-id="' + e(r.id) + '"') + botao('imprimir-evolucao', 'Imprimir', 'ti-printer', 'btn-fantasma btn-pequeno', ' data-id="' + e(r.id) + '"')) + '</div></article>';
  }
  function cartaoReceita(r, compacto) {
    var t = RX_TIPOS[r.tipo] || RX_TIPOS.simples;
    var nomes = (r.itens || []).map(function (it) { return it.nome; });
    return '<article class="hist-item" data-tipo="receita" data-id="' + e(r.id) + '"><div class="hist-cabeca"><div class="hist-meta">' + chipTipo(t.curto, r.tipo === 'controle' ? 'chip-aviso' : r.tipo === 'antimicrobiano' ? 'chip-acento' : '') + '</div><span class="texto-3 tnum">' + e(CL.fmt.dataHora(msDe(r.data, r.createdAt))) + '</span></div>' +
      '<div class="hist-texto is-3">' + e(nomes.join(' · ')) + '</div>' +
      '<div class="hist-acoes">' + botao('ver-receita', 'Abrir', 'ti-eye', 'btn-neutro btn-pequeno', ' data-id="' + e(r.id) + '"') + botao('imprimir-receita', 'Imprimir', 'ti-printer', 'btn-fantasma btn-pequeno', ' data-id="' + e(r.id) + '"') + (compacto ? '' : botao('nova-receita-de', 'Nova a partir desta', 'ti-copy', 'btn-fantasma btn-pequeno', ' data-id="' + e(r.id) + '"')) + '</div></article>';
  }
  function cartaoDocumento(dc, compacto) {
    return '<article class="hist-item" data-tipo="documento" data-id="' + e(dc.id) + '"><div class="hist-cabeca"><div class="hist-meta">' + chipTipo(DOC_TIPOS[dc.tipo] || dc.tipo, 'chip-acento') + (dc.tipo === 'atestado' && dc.cidAutorizado ? chipTipo('CID autorizado', 'chip-ok') : '') + '</div><span class="texto-3 tnum">' + e(CL.fmt.dataHora(msDe(dc.data, dc.createdAt))) + '</span></div>' +
      '<h3 class="hist-titulo">' + e(dc.titulo || DOC_TIPOS[dc.tipo] || 'Documento') + '</h3><div class="hist-texto is-3">' + e(dc.tipo === 'atestado' && !dc.cidAutorizado ? removerCid(dc.texto) : dc.texto) + '</div>' +
      '<div class="hist-acoes">' + botao('ver-documento', 'Abrir', 'ti-eye', 'btn-neutro btn-pequeno', ' data-id="' + e(dc.id) + '"') + botao('imprimir-documento', 'Imprimir', 'ti-printer', 'btn-fantasma btn-pequeno', ' data-id="' + e(dc.id) + '"') + (compacto ? '' : '') + '</div></article>';
  }
  function listaPor(col, pacId) {
    return CL.col(col).filter(function (x) { return x && x.pacId === pacId; }).sort(function (a, b) { return msDe(b.data, b.createdAt) - msDe(a.data, a.createdAt); });
  }
  function abrirAba(pacId, aba, box) {
    if (!box) return;
    if (!CL.can('clinico')) { box.innerHTML = '<div class="cadeado"><i class="ti ti-lock" aria-hidden="true"></i>Conteúdo clínico — perfil profissional</div>'; return; }
    var p = pac(pacId);
    if (!p) { box.innerHTML = ''; return; }
    box.setAttribute('data-pac', pacId);
    if (!box._atendimentoWired) { box._atendimentoWired = true; box.addEventListener('click', aoClicarAba); box.addEventListener('submit', aoSubmeterAba); }
    if (aba === 'evolucoes') {
      var evs = listaPor('evolucoes', pacId);
      var h = '<div class="linha-acoes pac-aba-acoes"><span class="texto-3 tnum">' + evs.length + ' evolução(ões)</span><span style="flex:1"></span>' + botao('nova-evolucao', 'Nova evolução', 'ti-plus', 'btn-primario') + '</div>';
      if (!evs.length) { box.innerHTML = h; var v = document.createElement('div'); box.appendChild(v); CL.ui.vazio(v, { icone: 'ti-notes', titulo: 'Nenhuma evolução', texto: 'Registre a primeira evolução — por voz, com IA ou digitando.', acao: { rotulo: 'Nova evolução', icone: 'ti-plus', fn: function () { abrirEvolucao({ pacId: pacId }); } } }); return; }
      box.innerHTML = h + '<div class="hist-lista">' + evs.map(function (r) { return cartaoEvolucao(r, false); }).join('') + '</div>';
    } else if (aba === 'receitas') {
      var rxs = listaPor('receitas', pacId);
      var h2 = '<div class="linha-acoes pac-aba-acoes"><span class="texto-3 tnum">' + rxs.length + ' receita(s)</span><span style="flex:1"></span>' + botao('nova-receita', 'Nova receita', 'ti-plus', 'btn-primario') + '</div>';
      if (!rxs.length) { box.innerHTML = h2; var v2 = document.createElement('div'); box.appendChild(v2); CL.ui.vazio(v2, { icone: 'ti-pill', titulo: 'Nenhuma receita', texto: 'Monte o receituário com o banco de medicamentos e imprima em A4.', acao: { rotulo: 'Nova receita', icone: 'ti-plus', fn: function () { abrirReceita({ pacId: pacId }); } } }); return; }
      box.innerHTML = h2 + '<div class="hist-lista">' + rxs.map(function (r) { return cartaoReceita(r, false); }).join('') + '</div>';
    } else if (aba === 'documentos') {
      var docs = listaPor('documentos', pacId);
      var h3 = '<div class="linha-acoes pac-aba-acoes"><span class="texto-3 tnum">' + docs.length + ' documento(s)</span><span style="flex:1"></span>' + botao('novo-atestado', 'Atestado', 'ti-file-certificate') + botao('novo-exames', 'Pedido de exames', 'ti-file-text') + botao('novo-documento', 'Outro documento', 'ti-plus', 'btn-primario') + '</div>';
      if (!docs.length) { box.innerHTML = h3; var v3 = document.createElement('div'); box.appendChild(v3); CL.ui.vazio(v3, { icone: 'ti-file-text', titulo: 'Nenhum documento', texto: 'Atestados, pedidos de exames, declarações, encaminhamentos, relatórios e termos ficam aqui.', acao: { rotulo: 'Novo atestado', icone: 'ti-file-certificate', fn: function () { abrirAtestado({ pacId: pacId }); } } }); return; }
      box.innerHTML = h3 + '<div class="hist-lista">' + docs.map(function (dc) { return cartaoDocumento(dc, false); }).join('') + '</div>';
    } else if (aba === 'exames') {
      renderLabs(box, pacId);
    } else box.innerHTML = '';
  }
  function aoSubmeterAba(ev) {
    var form = ev.target.closest('[data-lab-form]');
    if (!form) return;
    ev.preventDefault();
    var box = ev.currentTarget, pacId = box.getAttribute('data-pac');
    var g = function (n) { return form.querySelector('[name="' + n + '"]').value; };
    try {
      labs.adicionar({ pacId: pacId, nome: g('nome'), valor: g('valor'), unidade: g('unidade'), data: g('data') });
      CL.ui.toast('Resultado registrado', { kind: 'ok' });
      renderLabs(box, pacId);
      var n0 = box.querySelector('[data-lab-form] [name="nome"]'); if (n0) n0.focus();
    } catch (err) { CL.ui.toast(err.message, { kind: 'erro' }); }
  }
  function aoClicarAba(ev) {
    var a = ev.target.closest('[data-acao]');
    if (!a) return;
    var box = ev.currentTarget, pacId = box.getAttribute('data-pac');
    var id = a.getAttribute('data-id');
    var acao = a.getAttribute('data-acao');
    if (acao === 'nova-evolucao') abrirEvolucao({ pacId: pacId });
    else if (acao === 'ver-evolucao') verEvolucao(id);
    else if (acao === 'editar-evolucao') abrirEvolucao({ pacId: pacId, id: id });
    else if (acao === 'imprimir-evolucao') imprimirEvolucao(id);
    else if (acao === 'nova-receita') abrirReceita({ pacId: pacId });
    else if (acao === 'nova-receita-de') abrirReceita({ pacId: pacId, id: id });
    else if (acao === 'ver-receita') verReceita(id);
    else if (acao === 'imprimir-receita') imprimirReceita(id);
    else if (acao === 'novo-atestado') abrirAtestado({ pacId: pacId });
    else if (acao === 'novo-exames') abrirExames({ pacId: pacId });
    else if (acao === 'novo-documento') abrirDocumento({ pacId: pacId });
    else if (acao === 'ver-documento') verDocumento(id);
    else if (acao === 'imprimir-documento') imprimirDocumento(id);
    else if (acao === 'remover-lab') labs.remover(id).then(function (ok) { if (ok) renderLabs(box, pacId); });
  }

  /* =================== consulta: status (usa Agenda quando existir) =================== */
  function mudarStatus(id, novo) {
    if (window.Agenda && typeof Agenda.mudarStatus === 'function') return Promise.resolve(Agenda.mudarStatus(id, novo, {}));
    var c = CL.get('consultas', id);
    if (!c) return Promise.reject(new Error('Consulta não encontrada'));
    var de = c.status, agora = Date.now(), patch = { status: novo };
    if (novo === 'confirmado' && !c.confirmadoEm) patch.confirmadoEm = agora;
    if (novo === 'chegou' && !c.chegouEm) patch.chegouEm = agora;
    if (novo === 'em_atendimento' && !c.inicioEm) patch.inicioEm = agora;
    if (novo === 'finalizado') patch.fimEm = agora;
    var hist = Array.isArray(c.historico) ? c.historico.slice() : [];
    hist.push({ em: agora, usuario: CL.session ? CL.session.nome : '', acao: 'status', de: de, para: novo });
    patch.historico = hist;
    CL.patch('consultas', id, patch);
    CL.audit('consulta.status', 'consultas', id, { pacId: c.pacId, de: de, para: novo });
    CL.emit('consulta:status', { id: id, de: de, para: novo });
    return Promise.resolve({ ok: true, status: novo });
  }
  function iniciar(consultaId) {
    if (!podeAbrirProntuario()) return Promise.resolve();
    var c = CL.get('consultas', consultaId);
    if (!c) { CL.ui.toast('Consulta não encontrada', { kind: 'erro' }); return Promise.resolve(); }
    if (!c.pacId || !pac(c.pacId)) { CL.ui.toast('Vincule um paciente à consulta antes de iniciar o atendimento', { kind: 'aviso' }); return Promise.resolve(); }
    var pr = (c.status === 'em_atendimento' || c.status === 'finalizado') ? Promise.resolve() : mudarStatus(consultaId, 'em_atendimento');
    return pr.then(function () { CL.route.go('#/atendimento/' + encodeURIComponent(consultaId)); }, function (err) { CL.ui.toast(err.message || 'Não foi possível iniciar', { kind: 'erro' }); });
  }

  /* =================== tela de atendimento =================== */
  var tela = null;
  function renderHist(box, p) {
    var evs = listaPor('evolucoes', p.id).slice(0, 8);
    var rxs = listaPor('receitas', p.id).slice(0, 3);
    var docs = listaPor('documentos', p.id).slice(0, 3);
    var grupos = labs.grupos(p.id).slice(0, 6);
    var h = '';
    if (p.alergias) h += '<div class="aviso-inline is-erro at-alergia"><i class="ti ti-alert-triangle" aria-hidden="true"></i><span><strong>Alergias:</strong> ' + e(p.alergias) + '</span></div>';
    h += '<div class="card at-bloco"><div class="card-titulo"><i class="ti ti-clipboard-heart" aria-hidden="true"></i>Problemas e medicações</div>' +
      (p.problemas ? '<p class="rotulo">Problemas</p><div class="hist-pre">' + e(p.problemas) + '</div>' : '') + (p.meds ? '<p class="rotulo" style="margin-top:8px">Medicações em uso</p><div class="hist-pre">' + e(p.meds) + '</div>' : '') + (!p.problemas && !p.meds ? '<p class="texto-3">Nada registrado na ficha</p>' : '') + '</div>';
    h += '<div class="at-bloco"><div class="card-titulo"><i class="ti ti-notes" aria-hidden="true"></i>Evoluções anteriores</div>' + (evs.length ? '<div class="hist-lista">' + evs.map(function (r) { return cartaoEvolucao(r, true); }).join('') + '</div>' : '<p class="texto-3">Primeira evolução deste paciente</p>') + '</div>';
    h += '<div class="card at-bloco"><div class="card-titulo"><i class="ti ti-flask" aria-hidden="true"></i>Exames recentes</div>' + (grupos.length ? '<ul class="lista-simples">' + grupos.map(function (g) { return '<li><span style="flex:1">' + e(g.nome) + '</span><span class="tnum">' + e(fmtValor(g.ultimo.valor)) + ' ' + e(g.unidade) + ' ' + iconeTend(g.tendencia) + '</span><small class="texto-3 tnum">' + e(CL.fmt.data(g.ultimo.data)) + '</small></li>'; }).join('') + '</ul>' : '<p class="texto-3">Nenhum resultado registrado</p>') + '</div>';
    h += '<div class="at-bloco"><div class="card-titulo"><i class="ti ti-pill" aria-hidden="true"></i>Receitas recentes</div>' + (rxs.length ? '<div class="hist-lista">' + rxs.map(function (r) { return cartaoReceita(r, true); }).join('') + '</div>' : '<p class="texto-3">Nenhuma receita</p>') + '</div>';
    h += '<div class="at-bloco"><div class="card-titulo"><i class="ti ti-file-text" aria-hidden="true"></i>Documentos recentes</div>' + (docs.length ? '<div class="hist-lista">' + docs.map(function (dc) { return cartaoDocumento(dc, true); }).join('') + '</div>' : '<p class="texto-3">Nenhum documento</p>') + '</div>';
    box.innerHTML = h;
  }
  function renderTela() {
    var t = tela;
    if (!t) return;
    var c = CL.get('consultas', t.consultaId), p = pac(t.pacId);
    if (!c || !p) return;
    var proc = CL.get('procedimentos', c.procId), prof = profDe(c.profId);
    var idade = CL.fmt.idade(p.nasc);
    var selos = (window.Pacientes && Pacientes.selo) ? Pacientes.selo(p.id) : '';
    t.el.innerHTML = '<div class="at-tela" data-aba="ev">' +
      '<header class="at-topo"><div class="at-paciente"><a class="at-nome nome-paciente" href="#/pacientes/' + e(p.id) + '">' + e(CL.nomeExibido(p.nome)) + '</a><span class="texto-2">' + e([idade, p.sexo === 'M' ? 'Masculino' : p.sexo === 'F' ? 'Feminino' : ''].filter(Boolean).join(' · ')) + '</span>' + (p.alergias ? '<span class="chip chip-erro"><i class="ti ti-alert-triangle" aria-hidden="true"></i>' + e(p.alergias) + '</span>' : '') + selos + '</div>' +
      '<div class="at-consulta texto-2"><i class="ti ti-stethoscope" aria-hidden="true"></i><span>' + e(proc ? proc.nome : 'Consulta') + ' · ' + e(CL.fmt.data(c.data)) + ' ' + e(c.hora) + (prof ? ' · ' + e(prof.nome) : '') + '</span>' + CL.chipStatus(c.status) + '<span class="at-cronometro tnum" data-at="cronometro" aria-label="Tempo de atendimento">00:00</span></div>' +
      '<div class="at-topo-acoes"><button type="button" class="btn btn-neutro" data-acao="sair">Sair sem finalizar</button><button type="button" class="btn btn-primario" data-acao="finalizar"><i class="ti ti-circle-check" aria-hidden="true"></i>Finalizar</button></div></header>' +
      '<div class="segmentado at-abas" role="tablist" aria-label="Painéis"><button type="button" data-at-aba="hist" aria-pressed="false">Histórico</button><button type="button" data-at-aba="ev" aria-pressed="true">Evolução</button></div>' +
      '<div class="at-corpo"><aside class="at-hist" data-painel="hist" aria-label="Histórico do paciente"></aside>' +
      '<section class="at-editor" data-painel="ev"><div data-at="editor"></div>' +
      '<div class="at-emissao"><span class="rotulo">Emitir</span>' + botao('receita', 'Receita', 'ti-pill') + botao('atestado', 'Atestado', 'ti-file-certificate') + botao('exames', 'Exames', 'ti-flask') + botao('documento', 'Documento', 'ti-file-text') + botao('imprimir', 'Imprimir', 'ti-printer', 'btn-fantasma') + '</div></section></div></div>';
    renderHist(t.el.querySelector('[data-painel="hist"]'), p);
    if (t.editor) t.editor.destruir();
    t.editor = criarEditor(t.el.querySelector('[data-at="editor"]'), { pacId: p.id, consultaId: c.id, id: c.evolucaoId && CL.get('evolucoes', c.evolucaoId) ? c.evolucaoId : null, profId: c.profId, chave: 'consulta:' + c.id, inline: true, aoSalvar: function () { var hb = t.el.querySelector('[data-painel="hist"]'); if (hb) renderHist(hb, pac(t.pacId)); } });
    cronometro();
  }
  function cronometro() {
    var t = tela;
    if (!t) return;
    var c = CL.get('consultas', t.consultaId);
    var el = t.el.querySelector('[data-at="cronometro"]');
    if (!el || !c) return;
    var ini = c.inicioEm || t.montadoEm;
    el.textContent = fmtSeg((Date.now() - ini) / 1000);
  }
  function aoClicarTela(ev) {
    var t = tela;
    if (!t) return;
    var aba = ev.target.closest('[data-at-aba]');
    if (aba) {
      var raiz = t.el.querySelector('.at-tela');
      raiz.setAttribute('data-aba', aba.getAttribute('data-at-aba'));
      Array.prototype.forEach.call(t.el.querySelectorAll('[data-at-aba]'), function (b) { b.setAttribute('aria-pressed', b === aba ? 'true' : 'false'); });
      return;
    }
    var a = ev.target.closest('[data-acao]');
    if (!a || a.closest('[data-painel="hist"]')) return;
    var acao = a.getAttribute('data-acao');
    var c = CL.get('consultas', t.consultaId);
    var aoSalvar = function () { var hb = t.el.querySelector('[data-painel="hist"]'); if (hb) renderHist(hb, pac(t.pacId)); };
    if (acao === 'receita') abrirReceita({ pacId: t.pacId, consulta: c, aoSalvar: aoSalvar });
    else if (acao === 'atestado') abrirAtestado({ pacId: t.pacId, consulta: c, aoSalvar: aoSalvar });
    else if (acao === 'exames') abrirExames({ pacId: t.pacId, consulta: c, aoSalvar: aoSalvar });
    else if (acao === 'documento') abrirDocumento({ pacId: t.pacId, consulta: c, aoSalvar: aoSalvar });
    else if (acao === 'imprimir') {
      var d = t.editor ? t.editor.dados() : null;
      if (!d || !d.texto.trim()) { CL.ui.toast('Não há texto de evolução para imprimir', { kind: 'aviso' }); return; }
      abrirPrevia(printEvolucao({ pacId: t.pacId, profId: c ? c.profId : null, tipo: d.tipo, titulo: d.titulo, texto: d.texto }));
    }
    else if (acao === 'sair') { CL.ui.toast('Rascunho guardado — a consulta continua em atendimento', { kind: 'info' }); CL.route.go('#/agenda'); }
    else if (acao === 'finalizar') finalizar(t.consultaId);
  }
  function aoClicarHist(ev) {
    var t = tela;
    if (!t) return;
    var a = ev.target.closest('[data-acao]');
    if (!a) return;
    var id = a.getAttribute('data-id'), acao = a.getAttribute('data-acao');
    if (acao === 'ver-evolucao') verEvolucao(id);
    else if (acao === 'ver-receita') verReceita(id);
    else if (acao === 'imprimir-receita') imprimirReceita(id);
    else if (acao === 'ver-documento') verDocumento(id);
    else if (acao === 'imprimir-documento') imprimirDocumento(id);
  }
  function finalizar(consultaId) {
    var t = tela && tela.consultaId === consultaId ? tela : null;
    if (t && t.editor && t.editor.temTexto()) {
      try { t.editor.salvar({ silencioso: true }); } catch (err) { CL.ui.toast(err.message, { kind: 'erro' }); return Promise.resolve(); }
    }
    var c = CL.get('consultas', consultaId);
    if (!c) return Promise.resolve();
    var pr = c.status === 'finalizado' ? Promise.resolve() : mudarStatus(consultaId, 'finalizado');
    return pr.then(function () {
      CL.ui.toast('Consulta finalizada', { kind: 'ok' });
      CL.route.go('#/agenda');
    }, function (err) { CL.ui.toast(err.message || 'Não foi possível finalizar', { kind: 'erro' }); });
  }

  var Atendimento = window.Atendimento = {
    mount: function (el, params) {
      var id = params && params.seg && params.seg[0];
      if (!CL.can('clinico')) { CL.ui.toast('Seu perfil não abre o prontuário', { kind: 'aviso' }); CL.route.go('#/agenda', { replace: true }); return; }
      var c = id ? CL.get('consultas', id) : null;
      if (!c) { CL.ui.erro(el, { texto: 'Consulta não encontrada.', acao: { rotulo: 'Ir para a agenda', fn: function () { CL.route.go('#/agenda'); } } }); return; }
      var p = pac(c.pacId);
      if (!p) { CL.ui.erro(el, { texto: 'Esta consulta não tem paciente vinculado. Vincule na agenda antes de atender.', acao: { rotulo: 'Ir para a agenda', fn: function () { CL.route.go('#/agenda'); } } }); return; }
      tela = { el: el, consultaId: c.id, pacId: p.id, editor: null, timer: null, unsubs: [], montadoEm: Date.now() };
      el.addEventListener('click', aoClicarTela);
      renderTela();
      var hist = el.querySelector('[data-painel="hist"]');
      if (hist) hist.addEventListener('click', aoClicarHist);
      tela.timer = setInterval(cronometro, 1000);
      var deb = CL.util.debounce(function (info) {
        if (!tela) return;
        if (info && ['evolucoes', 'receitas', 'documentos', 'exames', 'pacientes', '*'].indexOf(info.col) < 0) return;
        var hb = tela.el.querySelector('[data-painel="hist"]');
        if (hb) renderHist(hb, pac(tela.pacId));
      }, 120);
      tela.unsubs.push(CL.on('change', deb));
      tela.unsubs.push(CL.on('privacidade', function () { var n = tela && tela.el.querySelector('.at-nome'); if (n) n.textContent = CL.nomeExibido(pac(tela.pacId).nome); }));
    },
    unmount: function () {
      if (!tela) return;
      clearInterval(tela.timer);
      if (tela.editor) tela.editor.destruir();
      tela.unsubs.forEach(function (u) { try { u(); } catch (err) { /* já removido */ } });
      tela.el.removeEventListener('click', aoClicarTela);
      tela = null;
    },
    iniciar: iniciar,
    finalizar: finalizar,
    mudarStatus: mudarStatus,
    evolucao: {
      abrir: abrirEvolucao, salvar: salvarEvolucao, ver: verEvolucao, rascunho: rascunho, ditar: ditar, gravar: gravar,
      estruturar: estruturar, transcrever: transcrever, resumoPaciente: resumoPaciente, editor: criarEditor, formatos: REC_FMT, tiposAtend: ATEND_TIPOS
    },
    receita: { abrir: abrirReceita, ver: verReceita, imprimir: imprimirReceita, buscarMed: buscarMed, classificar: classificar, separar: separar, modelos: modelos, tipos: RX_TIPOS, texto: textoReceita, print: printReceita, salvarLote: function (o) {
      var g = separar(o.itens, o.tipo);
      var salvas = [];
      ['simples', 'antimicrobiano', 'controle'].forEach(function (k) { if (g[k].length) salvas.push(CL.upsert('receitas', { pacId: o.pacId, profId: o.profId || profissionalAtual().id || null, consultaId: o.consultaId || null, data: agoraISO(), tipo: k, itens: g[k], obs: o.obs || '' })); });
      return salvas;
    } },
    atestado: { abrir: abrirAtestado, gerarTexto: gerarTextoAtestado, salvar: salvarDocumento, imprimir: imprimirDocumento, removerCid: removerCid, modelos: modelos },
    exames: { abrir: abrirExames, salvar: salvarDocumento, imprimir: imprimirDocumento, comuns: EXAMES_COMUNS },
    documento: { abrir: abrirDocumento, preencher: preencher, salvar: salvarDocumento, imprimir: imprimirDocumento, print: printDocumento, ver: verDocumento, tipos: DOC_TIPOS, modelosPadrao: DOC_MODELOS },
    labs: labs,
    imprimirEvolucao: imprimirEvolucao,
    abrirAba: function (pacId, aba, box) { if (box) box.setAttribute('data-aba-atual', aba); abrirAba(pacId, aba, box); },
    abrirResumo: abrirResumo,
    previa: abrirPrevia,
    numeroExtenso: numeroExtenso,
    iaDisponivel: iaOk,
    MED_DB: MED_DB
  };
  CL.route.register('atendimento', Atendimento);
})();
