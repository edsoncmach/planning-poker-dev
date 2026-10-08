import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import {
    getAuth,
    signInAnonymously
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';
import {
    get,
    getDatabase,
    onDisconnect,
    onValue,
    ref,
    set,
    update
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js';

const valoresCartas = ['0', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '?', '☕'];
const valoresNumericos = new Set(valoresCartas.filter(valor => Number.isFinite(Number(valor))));
const parametrosUrl = new URLSearchParams(window.location.search);
const salaInformada = parametrosUrl.get('room');
let salaId = salaInformada && /^[a-zA-Z0-9_-]{1,40}$/.test(salaInformada) ? salaInformada.toLowerCase() : null;
let caminhoSala = salaId ? `rooms/${salaId}` : null;
const containerCartas = document.getElementById('container-cartas');
const painelCriacao = document.getElementById('painel-criacao');
const formularioCriacao = document.getElementById('form-criar-sala');
const campoNomeSala = document.getElementById('nome-sala');
const botaoCriarSala = document.getElementById('btn-criar-sala');
const formularioEntrada = document.getElementById('form-entrada');
const campoNome = document.getElementById('nome-participante');
const mensagemStatus = document.getElementById('mensagem-status');
const painelEntrada = document.getElementById('painel-entrada');
const painelJogo = document.getElementById('painel-jogo');
const botaoEntrar = document.getElementById('btn-entrar');
const listaParticipantes = document.getElementById('lista-participantes');
const arenaMesa = document.querySelector('.arena-mesa');
const assentosMesa = document.getElementById('assentos-mesa');
const nomeMesa = document.getElementById('nome-mesa');
const resumoMesa = document.getElementById('resumo-mesa');
const mediaVotos = document.getElementById('media-votos');
const botaoRevelar = document.getElementById('btn-revelar');
const botaoNovaRodada = document.getElementById('btn-limpar');
const avisoDono = document.getElementById('aviso-dono');
const caixaSala = document.getElementById('sala-compartilhada');
let database;
let participanteId;
let nomeParticipante = '';
let metadataSala = null;
let participantes = {};
let votosRevelados = {};
let revelado = false;
let rodadaAtual = 1;
let ouvintesConectados = false;

painelCriacao.hidden = Boolean(salaId);
painelEntrada.hidden = !salaId;
caixaSala.hidden = !salaId;
if (salaId) {
    document.getElementById('codigo-sala').textContent = salaId;
    campoNome.value = sessionStorage.getItem(`planning-poker-name-${salaId}`) || '';
} else {
    document.getElementById('codigo-sala').textContent = 'Nova sala';
}

function atualizarStatus(mensagem, erro = false) {
    mensagemStatus.textContent = mensagem;
    mensagemStatus.classList.toggle('erro', erro);
}

function definirSala(id, nome) {
    salaId = id;
    caminhoSala = `rooms/${id}`;
    metadataSala = { ...(metadataSala || {}), name: nome };
    parametrosUrl.set('room', id);
    history.replaceState(null, '', `${window.location.pathname}?${parametrosUrl.toString()}`);
    document.getElementById('codigo-sala').textContent = nome;
    nomeMesa.textContent = nome;
    caixaSala.hidden = false;
    campoNome.value = sessionStorage.getItem(`planning-poker-name-${salaId}`) || '';
}

function criarIdSala(nome) {
    const slug = nome.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 28) || 'sala';
    const aleatorio = Array.from(crypto.getRandomValues(new Uint8Array(3)))
        .map(valor => valor.toString(16).padStart(2, '0'))
        .join('');
    return `${slug}-${aleatorio}`;
}

async function criarSala(evento) {
    evento.preventDefault();
    const nomeSala = campoNomeSala.value.trim();
    if (!nomeSala || !participanteId) return;

    const id = criarIdSala(nomeSala);
    const novoCaminhoSala = `rooms/${id}`;
    try {
        await set(ref(database, `${novoCaminhoSala}/meta`), {
            owner: participanteId,
            name: nomeSala
        });
        await set(ref(database, `${novoCaminhoSala}/state`), {
            revealed: false,
            round: '1'
        });
        definirSala(id, nomeSala);
        metadataSala.owner = participanteId;
        painelCriacao.hidden = true;
        painelEntrada.hidden = false;
        atualizarStatus('Sala criada. Informe seu nome para entrar como dono.');
    } catch (erro) {
        atualizarStatus('Não foi possível criar a sala. Confira as regras atualizadas do Firebase.', true);
        console.error(erro);
    }
}

function configurarCartas() {
    valoresCartas.forEach(valor => {
        const carta = document.createElement('button');
        carta.type = 'button';
        carta.className = 'carta';
        carta.textContent = valor;
        carta.setAttribute('aria-label', `Votar ${valor}`);
        carta.setAttribute('aria-pressed', 'false');
        carta.disabled = true;
        carta.addEventListener('click', () => enviarVoto(valor));
        containerCartas.appendChild(carta);
    });
}

function desenharParticipantes() {
    listaParticipantes.replaceChildren();
    const itens = Object.entries(participantes).sort(([, primeiro], [, segundo]) =>
        String(primeiro.name || '').localeCompare(String(segundo.name || ''), 'pt-BR')
    );

    itens.forEach(([id, participante]) => {
        const item = document.createElement('li');
        item.className = 'participante';
        const nome = document.createElement('span');
        const marcadorDono = id === metadataSala?.owner ? ' · dono' : '';
        nome.textContent = `${participante.name || 'Participante'}${id === participanteId ? ' (você)' : ''}${marcadorDono}`;
        const estado = document.createElement('span');
        const votou = participante.votedRound === rodadaAtual;
        estado.className = votou ? 'estado-voto votou' : 'estado-voto';
        estado.textContent = votou ? 'Votou' : 'Aguardando';
        item.append(nome, estado);
        listaParticipantes.appendChild(item);
    });

    document.getElementById('total-participantes').textContent = String(itens.length);
    document.getElementById('total-votos').textContent = String(
        itens.filter(([, participante]) => participante.votedRound === rodadaAtual).length
    );
    desenharAssentos();
}

function desenharAssentos() {
    assentosMesa.replaceChildren();
    const itens = Object.entries(participantes).sort(([, primeiro], [, segundo]) =>
        String(primeiro.name || '').localeCompare(String(segundo.name || ''), 'pt-BR')
    );
    const quantidade = itens.length;
    const votosEnviados = itens.filter(([, participante]) => participante.votedRound === rodadaAtual).length;
    const mobile = window.matchMedia('(max-width: 600px)').matches;
    arenaMesa.classList.toggle('equipe-pequena', quantidade > 0 && quantidade <= 6);
    arenaMesa.classList.toggle('equipe-cheia', quantidade > 4 && quantidade <= 6);
    arenaMesa.classList.toggle('compacta', quantidade > 7 && quantidade <= 12);
    arenaMesa.classList.toggle('densa', quantidade > 12);
    assentosMesa.dataset.quantidade = String(quantidade);
    resumoMesa.textContent = quantidade
        ? `${votosEnviados} de ${quantidade} votos enviados`
        : 'Aguardando participantes';

    itens.forEach(([id, participante], indice) => {
        let x;
        let y;
        if (quantidade <= 6) {
            const lado = indice % 2;
            const lugar = Math.floor(indice / 2);
            const lugaresNesteLado = lado === 0
                ? Math.ceil(quantidade / 2)
                : Math.floor(quantidade / 2);
            const posicoesVerticais = lugaresNesteLado === 3
                ? [18, 50, 82]
                : lugaresNesteLado === 2 ? [32, 68] : [50];
            x = mobile ? (lado === 0 ? 15 : 85) : (lado === 0 ? 8 : 92);
            y = posicoesVerticais[lugar];
        } else if (quantidade > 12) {
            const lugaresPorLado = Math.ceil(quantidade / 4);
            const lado = Math.floor(indice / lugaresPorLado);
            const lugar = indice % lugaresPorLado;
            const lugaresNesteLado = Math.min(lugaresPorLado, quantidade - lado * lugaresPorLado);
            const margemLateral = mobile ? 11 : 7;
            const posicao = (minimo, maximo) => lugaresNesteLado === 1
                ? 50
                : minimo + (maximo - minimo) * lugar / (lugaresNesteLado - 1);

            if (lado === 0) {
                x = posicao(18, 82);
                y = 9;
            } else if (lado === 1) {
                x = 100 - margemLateral;
                y = posicao(25, 75);
            } else if (lado === 2) {
                x = posicao(82, 18);
                y = 91;
            } else {
                x = margemLateral;
                y = posicao(75, 25);
            }
        } else {
            const angulo = -Math.PI / 2 + (2 * Math.PI * indice) / quantidade;
            const normalizador = Math.max(Math.abs(Math.cos(angulo)), Math.abs(Math.sin(angulo)));
            const raioHorizontal = mobile ? 38 : 43;
            const raioVertical = mobile ? 24 : 32;
            x = 50 + (Math.cos(angulo) / normalizador) * raioHorizontal;
            y = 50 + (Math.sin(angulo) / normalizador) * raioVertical;
        }
        const votou = participante.votedRound === rodadaAtual;
        const assento = document.createElement('article');
        assento.className = 'assento-mesa';
        assento.style.setProperty('--seat-x', `${x}%`);
        assento.style.setProperty('--seat-y', `${y}%`);

        const nome = document.createElement('p');
        nome.className = 'nome-assento';
        const marcadorDono = id === metadataSala?.owner ? ' · dono' : '';
        nome.textContent = `${participante.name || 'Participante'}${id === participanteId ? ' (você)' : ''}${marcadorDono}`;

        const estado = document.createElement('span');
        estado.className = votou ? 'estado-assento votou' : 'estado-assento';
        estado.textContent = votou ? 'Voto enviado' : 'Escolhendo';

        const carta = document.createElement('div');
        carta.className = 'carta-mesa';
        if (!votou) carta.classList.add('sem-voto');
        if (votou && revelado && Object.hasOwn(votosRevelados, id)) carta.classList.add('revelada');
        carta.setAttribute('aria-label', votou && revelado && Object.hasOwn(votosRevelados, id)
            ? `Voto de ${participante.name}: ${votosRevelados[id]}`
            : votou ? `Voto de ${participante.name} enviado e oculto` : `${participante.name} ainda não votou`);

        const faces = document.createElement('span');
        faces.className = 'faces-carta';
        const verso = document.createElement('span');
        verso.className = 'verso-carta';
        verso.setAttribute('aria-hidden', 'true');
        verso.textContent = votou ? 'PP' : '...';
        const frente = document.createElement('span');
        frente.className = 'frente-carta';
        frente.textContent = Object.hasOwn(votosRevelados, id) ? votosRevelados[id] : '–';
        faces.append(verso, frente);
        carta.appendChild(faces);
        assento.append(nome, estado, carta);
        assentosMesa.appendChild(assento);
    });
}

function mostrarVotos(votos) {
    const entradas = Object.entries(votos || {});
    votosRevelados = Object.fromEntries(entradas);
    desenharAssentos();

    const votosNumericos = entradas
        .map(([, valor]) => String(valor))
        .filter(valor => valoresNumericos.has(valor))
        .map(Number);
    const media = votosNumericos.length
        ? votosNumericos.reduce((soma, valor) => soma + valor, 0) / votosNumericos.length
        : null;
    const descricaoMedia = media === null
        ? 'Não houve votos numéricos; cartas ? e ☕ não entram na média.'
        : `Média de ${media.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} pontos entre ${votosNumericos.length} votos numéricos. Cartas ? e ☕ não entram no cálculo.`;
    mediaVotos.textContent = media === null
        ? 'Média: sem votos numéricos'
        : `Média: ${media.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} pontos`;
    mediaVotos.title = descricaoMedia;
    mediaVotos.setAttribute('aria-label', descricaoMedia);
    mediaVotos.hidden = false;
}

async function sincronizarResultados() {
    if (!revelado) {
        votosRevelados = {};
        desenharAssentos();
        mediaVotos.hidden = true;
        mediaVotos.textContent = '';
        return;
    }

    try {
        const snapshot = await get(ref(database, `${caminhoSala}/rounds/${rodadaAtual}/votes`));
        mostrarVotos(snapshot.val());
    } catch (erro) {
        atualizarStatus('Não foi possível carregar os votos revelados. Confira as regras do banco.', true);
        console.error(erro);
    }
}

function conectarSala() {
    if (ouvintesConectados) return;
    ouvintesConectados = true;

    onValue(ref(database, `${caminhoSala}/participants`), snapshot => {
        participantes = snapshot.val() || {};
        desenharParticipantes();
        if (revelado) sincronizarResultados();
    }, erro => {
        atualizarStatus('Sem acesso à sala. Confira as regras do Firebase Realtime Database.', true);
        console.error(erro);
    });

    onValue(ref(database, `${caminhoSala}/state`), snapshot => {
        const estado = snapshot.val() || {};
        const proximaRodada = Number(estado.round) || 1;
        if (proximaRodada !== rodadaAtual) {
            rodadaAtual = proximaRodada;
            document.getElementById('voto-atual').textContent = 'Nenhum';
            document.querySelectorAll('.carta').forEach(carta => {
                carta.classList.remove('selecionada');
                carta.setAttribute('aria-pressed', 'false');
            });
            registrarLimpezaAoDesconectar();
        }
        revelado = estado.revealed === true;
        botaoRevelar.hidden = !isDono();
        botaoNovaRodada.hidden = !isDono();
        avisoDono.hidden = isDono();
        botaoRevelar.disabled = revelado;
        botaoRevelar.textContent = revelado ? 'Votos revelados' : 'Revelar votos';
        document.querySelectorAll('.carta').forEach(carta => {
            carta.disabled = revelado;
        });
        atualizarStatus(revelado ? 'Votos revelados para todos na sala.' : 'Votos ocultos até a revelação.');
        sincronizarResultados();
    }, erro => {
        atualizarStatus('Não foi possível ler o estado da rodada. Confira as regras do Firebase.', true);
        console.error(erro);
    });
}

function isDono() {
    return metadataSala?.owner === participanteId;
}

async function registrarLimpezaAoDesconectar() {
    if (!participanteId) return;
    try {
        await Promise.all([
            onDisconnect(ref(database, `${caminhoSala}/participants/${participanteId}`)).remove(),
            onDisconnect(ref(database, `${caminhoSala}/rounds/${rodadaAtual}/votes/${participanteId}`)).remove()
        ]);
    } catch (erro) {
        console.error('Não foi possível configurar a limpeza da presença.', erro);
    }
}

async function carregarMetadataOuReivindicarSala() {
    const metadataRef = ref(database, `${caminhoSala}/meta`);
    let snapshot = await get(metadataRef);
    if (!snapshot.exists()) {
        try {
            await set(metadataRef, { owner: participanteId, name: salaId });
            snapshot = await get(metadataRef);
        } catch (erro) {
            snapshot = await get(metadataRef);
            if (!snapshot.exists()) throw erro;
        }
    }

    metadataSala = snapshot.val();
    if (!metadataSala?.owner || !metadataSala?.name) {
        throw new Error('Os metadados da sala estão incompletos.');
    }
    document.getElementById('codigo-sala').textContent = metadataSala.name;
    nomeMesa.textContent = metadataSala.name;

    const estadoSnapshot = await get(ref(database, `${caminhoSala}/state`));
    if (!estadoSnapshot.exists() && isDono()) {
        await set(ref(database, `${caminhoSala}/state`), { revealed: false, round: '1' });
    }
}

async function entrarNaSala(evento) {
    evento.preventDefault();
    nomeParticipante = campoNome.value.trim();
    if (!nomeParticipante || !participanteId || !caminhoSala) return;

    const participanteRef = ref(database, `${caminhoSala}/participants/${participanteId}`);
    try {
        await carregarMetadataOuReivindicarSala();
        await registrarLimpezaAoDesconectar();
        const atual = await get(participanteRef);
        await update(participanteRef, {
            name: nomeParticipante,
            votedRound: atual.val()?.votedRound ?? null
        });
        sessionStorage.setItem(`planning-poker-name-${salaId}`, nomeParticipante);
        painelEntrada.hidden = true;
        painelJogo.hidden = false;
        document.querySelectorAll('.carta').forEach(carta => {
            carta.disabled = false;
        });
        conectarSala();
        atualizarStatus('Você entrou na sala. Escolha uma carta para votar.');
    } catch (erro) {
        atualizarStatus('Não foi possível entrar. Confira as regras de sala e participantes no Firebase.', true);
        console.error(erro);
    }
}

async function enviarVoto(valor) {
    if (!participanteId || revelado) return;

    document.getElementById('voto-atual').textContent = valor;
    document.querySelectorAll('.carta').forEach(carta => {
        carta.classList.toggle('selecionada', carta.textContent === valor);
        carta.setAttribute('aria-pressed', String(carta.textContent === valor));
    });

    try {
        await Promise.all([
            set(ref(database, `${caminhoSala}/rounds/${rodadaAtual}/votes/${participanteId}`), valor),
            update(ref(database, `${caminhoSala}/participants/${participanteId}`), { votedRound: rodadaAtual })
        ]);
        atualizarStatus('Voto registrado. Os valores ficam ocultos até a revelação.');
    } catch (erro) {
        atualizarStatus('Não foi possível registrar seu voto. Confira as regras do Firebase.', true);
        console.error(erro);
    }
}

async function revelarVotos() {
    if (!isDono()) return;
    try {
        await set(ref(database, `${caminhoSala}/state`), { revealed: true, round: String(rodadaAtual) });
    } catch (erro) {
        atualizarStatus('Não foi possível revelar os votos. Somente o dono pode controlar a rodada.', true);
        console.error(erro);
    }
}

async function iniciarNovaRodada() {
    if (!isDono()) return;
    try {
        await set(ref(database, `${caminhoSala}/state`), { revealed: false, round: String(rodadaAtual + 1) });
        document.getElementById('voto-atual').textContent = 'Nenhum';
        document.querySelectorAll('.carta').forEach(carta => {
            carta.classList.remove('selecionada');
            carta.setAttribute('aria-pressed', 'false');
        });
        atualizarStatus('Nova rodada iniciada.');
    } catch (erro) {
        atualizarStatus('Não foi possível iniciar a rodada. Somente o dono pode controlar a rodada.', true);
        console.error(erro);
    }
}

document.getElementById('btn-copiar-link').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(window.location.href);
        atualizarStatus('Link da sala copiado.');
    } catch (erro) {
        atualizarStatus('Não foi possível copiar o link neste navegador.', true);
    }
});

formularioCriacao.addEventListener('submit', criarSala);
formularioEntrada.addEventListener('submit', entrarNaSala);
botaoRevelar.addEventListener('click', revelarVotos);
botaoNovaRodada.addEventListener('click', iniciarNovaRodada);
configurarCartas();
window.addEventListener('resize', desenharAssentos);

const configuracaoValida = Object.values(firebaseConfig).every(valor =>
    typeof valor === 'string' && valor.length > 0 && !valor.includes('COLOQUE_')
);

if (!configuracaoValida) {
    atualizarStatus('Configure as credenciais do Firebase em firebase-config.js para habilitar a sala.', true);
} else {
    try {
        const app = initializeApp(firebaseConfig);
        const autenticacao = getAuth(app);
        database = getDatabase(app);
        signInAnonymously(autenticacao).then(credencial => {
            participanteId = credencial.user.uid;
            botaoEntrar.disabled = false;
            botaoCriarSala.disabled = false;
            atualizarStatus(salaId ? 'Conexão pronta. Informe seu nome para entrar.' : 'Conexão pronta. Crie uma sala para começar.');
        }).catch(erro => {
            atualizarStatus('Falha na autenticação anônima. Ative esse provedor no Firebase.', true);
            console.error(erro);
        });
    } catch (erro) {
        atualizarStatus('Configuração do Firebase inválida. Revise firebase-config.js.', true);
        console.error(erro);
    }
}