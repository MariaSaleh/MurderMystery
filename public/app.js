/* global io */

(function () {
    const socket = io({ transports: ['websocket', 'polling'] });

    const views = {
        entry: document.getElementById('view-entry'),
        hostFlow: document.getElementById('view-host-flow'),
        joinFlow: document.getElementById('view-join-flow'),
        lobby: document.getElementById('view-lobby'),
        admin: document.getElementById('view-admin'),
        game: document.getElementById('view-game'),
    };

    const stepHost1 = document.getElementById('step-host-1');
    const stepHost2 = document.getElementById('step-host-2');

    const els = {
        hostNameCreate: document.getElementById('host-name-create'),
        btnCreateRoom: document.getElementById('btn-create-room'),
        roomCodeDisplay: document.getElementById('room-code-display'),
        btnCopyCode: document.getElementById('btn-copy-code'),
        scenarioList: document.getElementById('scenario-list'),
        selectedScenarioLabel: document.getElementById('selected-scenario-label'),
        btnStartGame: document.getElementById('btn-start-game'),
        joinName: document.getElementById('join-name'),
        joinCode: document.getElementById('join-code'),
        btnJoinRoom: document.getElementById('btn-join-room'),
        playerList: document.getElementById('player-list'),
        lobbyTitle: document.getElementById('lobby-title'),
        lobbySubtitle: document.getElementById('lobby-subtitle'),
        lobbyAdminHint: document.getElementById('lobby-admin-hint'),
        playerListLabel: document.getElementById('player-list-label'),
        globalError: document.getElementById('global-error'),
        gameCase: document.getElementById('game-case-title'),
        gameChar: document.getElementById('game-char-name'),
        gameBio: document.getElementById('game-char-bio'),
        gameSecret: document.getElementById('game-char-secret'),
        killerBanner: document.getElementById('killer-banner'),
        adminCaseLine: document.getElementById('admin-case-line'),
        adminInvestigation: document.getElementById('admin-investigation'),
        adminChatLog: document.getElementById('admin-chat-log'),
        adminDocList: document.getElementById('admin-doc-list'),
        btnRefreshDocs: document.getElementById('btn-refresh-docs'),
        playerChatFeed: document.getElementById('player-chat-feed'),
        toastStack: document.getElementById('toast-stack'),
    };

    const state = {
        mode: null,
        roomCode: null,
        sessionId: null,
        hostToken: null,
        selectedScenarioId: null,
        catalog: [],
    };

    function showView(name) {
        Object.keys(views).forEach((k) => {
            views[k].classList.toggle('hidden', k !== name);
        });
    }

    function setError(text) {
        if (!els.globalError) {
            return;
        }
        if (!text) {
            els.globalError.classList.add('hidden');
            els.globalError.textContent = '';
            return;
        }
        els.globalError.textContent = text;
        els.globalError.classList.remove('hidden');
    }

    function storageKey(room) {
        return `mm_host_${room}`;
    }

    function saveHostSession(roomCode, hostToken) {
        try {
            sessionStorage.setItem(storageKey(roomCode), JSON.stringify({ hostToken }));
        } catch {
            /* ignore */
        }
    }

    function pushToast(title, body) {
        if (!els.toastStack) {
            return;
        }
        const t = document.createElement('div');
        t.className = 'toast';
        const strong = document.createElement('strong');
        strong.textContent = title;
        t.appendChild(strong);
        if (body) {
            const p = document.createElement('div');
            p.textContent = body;
            t.appendChild(p);
        }
        els.toastStack.appendChild(t);
        setTimeout(() => {
            t.remove();
        }, 9000);
    }

    function appendChatLine(container, from, text) {
        if (!container) {
            return;
        }
        const line = document.createElement('div');
        line.className = 'line';
        line.textContent = `${from}: ${text}`;
        container.appendChild(line);
        container.scrollTop = container.scrollHeight;
    }

    function requestDocumentList() {
        if (!state.roomCode) {
            return;
        }
        socket.emit('feature:document:list', { roomCode: state.roomCode });
    }

    function showLobby(isHost, scenarioTitle) {
        showView('lobby');
        els.lobbyTitle.textContent = isHost ? 'Your room' : 'In the lobby';
        els.lobbySubtitle.textContent = scenarioTitle ? `Case file: ${scenarioTitle}` : 'The admin will choose a case.';
        els.lobbyAdminHint.classList.toggle('hidden', !isHost);
        els.playerListLabel.textContent = isHost ? 'Guest players (receive roles)' : 'Other guests';
        els.btnStartGame.classList.toggle('hidden', !(isHost && state.mode === 'host'));
    }

    document.getElementById('btn-goto-host').addEventListener('click', () => {
        state.mode = 'host';
        showView('hostFlow');
        views.entry.classList.add('hidden');
        stepHost1.classList.remove('hidden');
        stepHost2.classList.add('hidden');
        setError('');
        socket.emit('catalog:request');
    });

    document.getElementById('btn-goto-join').addEventListener('click', () => {
        state.mode = 'join';
        showView('joinFlow');
        setError('');
    });

    document.getElementById('btn-back-entry').addEventListener('click', () => {
        state.mode = null;
        showView('entry');
        views.entry.classList.remove('hidden');
        setError('');
    });

    document.getElementById('btn-back-entry-join').addEventListener('click', () => {
        state.mode = null;
        showView('entry');
        views.entry.classList.remove('hidden');
        setError('');
    });

    els.btnCreateRoom.addEventListener('click', () => {
        setError('');
        socket.emit('room:create', { hostName: els.hostNameCreate.value });
    });

    els.btnCopyCode.addEventListener('click', async () => {
        const code = els.roomCodeDisplay.textContent.trim();
        try {
            await navigator.clipboard.writeText(code);
            els.btnCopyCode.textContent = 'Copied';
            setTimeout(() => {
                els.btnCopyCode.textContent = 'Copy';
            }, 2000);
        } catch {
            els.btnCopyCode.textContent = 'Copy';
        }
    });

    els.joinCode.addEventListener('input', () => {
        els.joinCode.value = els.joinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    });

    els.btnJoinRoom.addEventListener('click', () => {
        setError('');
        socket.emit('room:join', {
            roomCode: els.joinCode.value.trim().toUpperCase(),
            name: els.joinName.value,
        });
    });

    els.btnStartGame.addEventListener('click', () => {
        setError('');
        if (!state.roomCode || !state.hostToken) {
            setError('Host session missing. Create a room again.');
            return;
        }
        socket.emit('game:start', { roomCode: state.roomCode, hostToken: state.hostToken });
    });

    if (els.btnRefreshDocs) {
        els.btnRefreshDocs.addEventListener('click', () => {
            requestDocumentList();
        });
    }

    socket.on('catalog:data', (list) => {
        state.catalog = Array.isArray(list) ? list : [];
        els.scenarioList.innerHTML = '';
        state.catalog.forEach((s) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'scenario-card';
            const h = document.createElement('h3');
            h.textContent = s.title;
            const p = document.createElement('p');
            p.textContent = s.description || '';
            btn.appendChild(h);
            btn.appendChild(p);
            btn.addEventListener('click', () => {
                document.querySelectorAll('.scenario-card').forEach((c) => c.classList.remove('is-selected'));
                btn.classList.add('is-selected');
                state.selectedScenarioId = s.id;
                els.selectedScenarioLabel.textContent = s.title;
                if (state.roomCode && state.hostToken) {
                    socket.emit('scenario:mount', {
                        roomCode: state.roomCode,
                        hostToken: state.hostToken,
                        scenarioId: s.id,
                    });
                }
            });
            els.scenarioList.appendChild(btn);
        });
    });

    socket.on('room:createResult', (res) => {
        if (!res || !res.ok) {
            setError((res && res.error) || 'Could not create room.');
        }
    });

    socket.on('room:created', (data) => {
        if (!data || !data.roomCode || !data.hostToken) {
            return;
        }
        state.roomCode = data.roomCode;
        state.sessionId = data.sessionId || null;
        state.hostToken = data.hostToken;
        saveHostSession(data.roomCode, data.hostToken);
        els.roomCodeDisplay.textContent = data.roomCode;
        stepHost1.classList.add('hidden');
        stepHost2.classList.remove('hidden');
    });

    socket.on('room:joinResult', (res) => {
        if (!res || !res.ok) {
            setError((res && res.error) || 'Could not join.');
            return;
        }
        state.roomCode = res.roomCode;
        state.sessionId = res.sessionId || null;
        showLobby(false, res.scenarioTitle);
    });

    socket.on('scenario:mounted', (info) => {
        const t = info && info.title ? info.title : '';
        if (t) {
            els.lobbySubtitle.textContent = `Case file: ${t}`;
        }
    });

    socket.on('scenario:mountResult', (res) => {
        if (!res || !res.ok) {
            setError((res && res.error) || 'Could not load scenario.');
            return;
        }
        const title = state.selectedScenarioId
            ? (state.catalog.find((c) => c.id === state.selectedScenarioId) || {}).title
            : '';
        showLobby(true, title || '');
    });

    socket.on('lobby:players', (names) => {
        els.playerList.innerHTML = '';
        (names || []).forEach((n) => {
            const li = document.createElement('li');
            li.textContent = n;
            els.playerList.appendChild(li);
        });
        const isHost = state.mode === 'host';
        const enough = names && names.length >= 2;
        els.btnStartGame.classList.toggle('hidden', !(isHost && enough));
    });

    socket.on('game:startResult', (res) => {
        if (!res || !res.ok) {
            setError((res && res.error) || 'Cannot start.');
        }
    });

    socket.on('game:started', (payload) => {
        if (state.mode === 'host') {
            showView('admin');
            els.adminCaseLine.textContent = payload && payload.scenarioTitle ? `Active case: ${payload.scenarioTitle}` : '';
            els.adminInvestigation.textContent = '—';
            els.adminChatLog.innerHTML = '';
            els.adminDocList.innerHTML = '';
            requestDocumentList();
        }
    });

    socket.on('session:ended', (payload) => {
        const msg = (payload && payload.message) || 'This session has ended.';
        setError(msg);
        state.roomCode = null;
        state.sessionId = null;
        state.hostToken = null;
        showView('entry');
        views.entry.classList.remove('hidden');
    });

    socket.on('GAME_START', (payload) => {
        const d = payload && payload.dossier ? payload.dossier : null;
        if (!d || !d.character) {
            return;
        }
        showView('game');
        els.gameCase.textContent = payload.scenarioTitle || '';
        els.gameChar.textContent = d.character.name || '';
        els.gameBio.textContent = d.character.bio || '';
        els.gameSecret.textContent = d.character.secret || '';
        const isKiller = !!d.isKiller;
        els.killerBanner.classList.toggle('hidden', !isKiller);
        const theme = payload.theme;
        if (theme && theme.primary) {
            document.documentElement.style.setProperty('--gold', theme.primary);
        }
        if (els.playerChatFeed) {
            els.playerChatFeed.innerHTML = '';
            els.playerChatFeed.classList.add('hidden');
        }
    });

    socket.on('feature:investigation:sync', (payload) => {
        if (els.adminInvestigation && payload && payload.data !== undefined) {
            els.adminInvestigation.textContent = JSON.stringify(
                { version: payload.version, data: payload.data },
                null,
                2
            );
        }
    });

    socket.on('feature:chat:message', (payload) => {
        if (!payload || !payload.text) {
            return;
        }
        if (state.mode === 'host' && views.admin && !views.admin.classList.contains('hidden')) {
            appendChatLine(els.adminChatLog, payload.from, payload.text);
        }
        if (state.mode === 'join' && els.playerChatFeed && views.game && !views.game.classList.contains('hidden')) {
            els.playerChatFeed.classList.remove('hidden');
            appendChatLine(els.playerChatFeed, payload.from, payload.text);
        }
    });

    socket.on('feature:document:listResult', (res) => {
        if (!res || !res.ok || !els.adminDocList) {
            return;
        }
        els.adminDocList.innerHTML = '';
        (res.items || []).forEach((doc) => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = doc.url || '#';
            a.textContent = doc.originalName || doc.url || 'Document';
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            li.appendChild(a);
            els.adminDocList.appendChild(li);
        });
    });

    socket.on('feature:notify:toast', (payload) => {
        if (!payload) {
            return;
        }
        pushToast(payload.title || 'Notice', payload.body || '');
    });

    socket.on('feature:clue:received', (payload) => {
        if (!payload) {
            return;
        }
        pushToast('Clue', payload.text || '');
    });

    window.addEventListener('load', () => {
        socket.emit('catalog:request');
    });
})();
