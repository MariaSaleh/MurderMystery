/**
 * Per-room mutable state for investigations, clues, notifications, shared documents, and chat.
 * Each physical room session (Socket.IO room + `rooms` Map entry) has its own instance — groups never share state.
 */
function createExtensionState() {
    return {
        investigations: {
            version: 0,
            /** @type {Record<string, unknown>} */
            data: {},
        },
        /** clueId -> { targetSocketId, payload } */
        clues: {},
        /** @type {{ id: string, targetSocketId: string, title: string, body: string, createdAt: number }[]} */
        notificationLog: [],
        /** @type {{ id: string, originalName: string, url: string, uploadedAt: number }[]} */
        documents: [],
        /** @type {{ id: string, from: string, text: string, ts: number }[]} */
        chatMessages: [],
    };
}

/**
 * Drop clues and notifications targeting a disconnected or removed player socket.
 * @param {ReturnType<createExtensionState>} extensions
 * @param {string} removedSocketId
 */
function removePlayerFromExtensions(extensions, removedSocketId) {
    if (!extensions || !removedSocketId) {
        return;
    }
    const clues = extensions.clues || {};
    for (const key of Object.keys(clues)) {
        if (clues[key].targetSocketId === removedSocketId) {
            delete clues[key];
        }
    }
    if (Array.isArray(extensions.notificationLog)) {
        extensions.notificationLog = extensions.notificationLog.filter(
            (n) => n.targetSocketId !== removedSocketId
        );
    }
}

module.exports = { createExtensionState, removePlayerFromExtensions };
