import "./index.css";
import "./polyfill";
import { init, debug } from "@livechat/customer-sdk";
import * as DOMElements from "./DOMElements";
import * as DOMOperations from "./DOMOperations";

const loader = document.getElementById("lc-loader");
loader.innerHTML = DOMElements.logoLoader;

const historyStates = {
  DONE: "DONE",
  INACTIVE: "INACTIVE",
  LOADING: "LOADING"
};

const noop = () => {};

const sdk = debug(
  init({
    organizationId: "403bde89-99db-41f4-8424-6f1b1d2a83f8",
    clientId: "eb9a6e77686798e0623b942088108f45"
  })
);
window.sdk = sdk;

const state = {
  chat: null,
  active: false,
  activating: false,
  users: {},
  pendingMessages: [],
  customerId: null,
  historyStatus: historyStates.INACTIVE,
  history: null
};

const isAgent = (user) => user.id !== state.customerId;

sdk.on("connected", () => {
  sdk.listChats().then(({ chatsSummary, totalChats }) => {
    if (state.chat) {
      return;
    }

    DOMOperations.enableInput();
    DOMOperations.enableSendButton();

    if (totalChats === 0) {
      loader.parentElement.removeChild(loader);
      DOMOperations.showFooter();
      DOMOperations.showStartChatButton();
      return;
    }

    state.chat = chatsSummary[0].id;
    state.active = chatsSummary[0].active;

    loadInitialHistory().then(() => {
      loader.parentElement.removeChild(loader);
      DOMOperations.showFooter();
      if (!state.active) {
        DOMOperations.hideChat();
      } else {
        DOMOperations.showChat();
      }
    });
  });
});
sdk.on("connection_restored", noop);
sdk.on("user_is_typing", noop);
sdk.on("user_stopped_typing", noop);
sdk.on("user_joined_chat", noop);
sdk.on("user_left_chat", noop);

sdk.on("customer_id", (id) => {
  console.log(id);
  state.customerId = id;
});

const onConnectionLost = () => {
  DOMOperations.disableInput("Disconnected");
  DOMOperations.disableSendButton();
};

sdk.on("connection_lost", () => {
  onConnectionLost();
});

sdk.on("diconnected", (reason) => {
  onConnectionLost();
});

sdk.on("user_data", (user) => {
  state.users[user.id] = user;
});

sdk.on("incoming_chat", ({ chat }) => handleChatStart(chat));

sdk.on("incoming_event", ({ event }) => {
  if (!state.chat || event.type !== "message") {
    return;
  }
  const author = state.users[event.authorId];
  DOMOperations.appendMessage(
    DOMOperations.createMessage(
      event.id,
      event.text,
      isAgent(author) ? "agent" : "customer",
      author.avatar
    )
  );
});

sdk.on("chat_deactivated", () => {
  state.active = false;
  DOMOperations.hideChat();
});

const handleChatStart = (chat) => {
  state.chat = chat.id;
  state.historyStatus = historyStates.DONE;
  state.active = true;
  state.activating = false;
  state.pendingMessages = [];
  const messages = getMessagesFromThreads([chat.thread]);
  messages.forEach((message) => DOMOperations.appendMessage(message));
  DOMOperations.scrollToBottom();
  DOMOperations.showChat();
};

const sendMessage = (chat, id, text) => {
  const message = { customId: id, text, type: "message" };

  sdk.sendEvent({ chatId: chat, event: message }).then(
    (confirmedMessage) => {
      DOMOperations.confirmMessageAsSent(id);
    },
    () => {
      DOMOperations.markAsFailedMessage(id);
    }
  );
};

const startChat = () => {
  state.activating = true;
  const payload = {
    chat: {
      ...(state.chat && { id: state.chat }),
      thread: {
        events: state.pendingMessages.map((event) => {
          return {
            type: "message",
            text: event.message,
            customId: event.id
          };
        })
      }
    }
  };
  const action = state.chat ? sdk.activateChat : sdk.startChat;
  action(payload)
    .then(({ chat }) => {
      handleChatStart(chat);
    })
    .catch(() => {
      state.activating = false;
      state.pendingMessages.forEach(({ messageId: id }) =>
        DOMOperations.markAsFailedMessage(id)
      );
      state.pendingMessages = [];
    });
};

const handleMessage = () => {
  const text = DOMElements.input.value;
  DOMElements.input.value = "";

  if (!text) {
    return;
  }

  const messageId = `${Math.random() * 1000}`;

  if (state.active) {
    sendMessage(state.chat, messageId, text);
  } else {
    if (!state.activating) {
      startChat();
    }
    state.pendingMessages.push({ messageId, text });
  }

  DOMOperations.appendMessage(
    DOMOperations.createMessage(messageId, text, "customer")
  );
  DOMOperations.scrollToBottom();
};

DOMElements.startChatButton.onclick = startChat;

DOMElements.sendButton.onclick = handleMessage;

DOMElements.minimizeButton.onclick = DOMOperations.toggleMinimized;

DOMElements.lcWindowMinimized.onclick = DOMOperations.toggleMinimized;

DOMElements.input.onkeydown = (event) => {
  if (event.which !== 13) {
    return;
  }
  event.preventDefault();
  handleMessage();
};

const loadHistory = (chat) => {
  return new Promise((resolve, reject) => {
    state.historyStatus = historyStates.LOADING;
    state.history.next().then(
      ({ value: { threads }, done }) => {
        if (!threads) {
          return;
        }

        const messages = getMessagesFromThreads(threads);
        const messageList = DOMOperations.getMessageList(chat);

        const fromTheBottom =
          messageList.scrollHeight -
          (messageList.scrollTop + messageList.clientHeight);

        DOMOperations.prependMessages(chat, messages);

        messageList.scrollTop =
          messageList.scrollHeight - messageList.clientHeight - fromTheBottom;

        state.historyStatus = done
          ? historyStates.DONE
          : historyStates.INACTIVE;
        resolve();
      },
      (err) => {
        state.historyStatus = historyStates.INACTIVE;
        reject(err);
      }
    );
  });
};

const getMessagesFromThreads = (threads) =>
  threads
    .map(({ events }) => events || [])
    .reduce((acc, current) => [...acc, ...current], [])
    .filter((event) => event.type === "message")
    .map((event) => {
      const author = state.users[event.authorId];
      return DOMOperations.createMessage(
        event.id,
        event.text,
        isAgent(author) ? "agent" : "customer",
        author.avatar
      );
    });

const loadInitialHistory = () => {
  const chatId = state.chat;

  state.history = sdk.getChatHistory({ chatId });

  const loadLatestHistory = () =>
    loadHistory(chatId).then(() => DOMOperations.scrollToBottom());

  return loadLatestHistory()
    .catch(() => loadLatestHistory())
    .catch(noop);
};

DOMOperations.delegate(
  "#lc",
  ".chat",
  "mousewheel",
  DOMOperations.throttle(300, function loadMore() {
    const chatId = this.dataset.id;
    const chat = state.chats[chatId];

    if (this.scrollTop < 50 && chat.historyStatus === historyStates.INACTIVE) {
      loadHistory(chatId).catch(noop);
    }
  })
);

window.addEventListener("beforeunload", sdk.disconnect);
