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

module.exports = { createExtensionState };
