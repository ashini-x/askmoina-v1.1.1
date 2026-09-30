export default function(component) {
  const root = component.parentElement;
  const qs = (selector, scope = root) => scope.querySelector(selector);
  const qsa = (selector, scope = root) => Array.from(scope.querySelectorAll(selector));
  const sendEvent = (payload) => component.setTriggerValue("event", payload);

  if (!root.__askmoinaCtx) {
    root.__askmoinaCtx = {
      component,
      data: {},
      state: {
        mode: "auto",
        expandedPrompts: new Set(),
        workflowPhase: "idle",
        workflowJobId: null,
        workflowStatus: "idle",
        revealPendingJobId: null,
        revealTimer: null,
        toastTimer: null,
        scrollTimer: null,
        lastMessagesKey: null,
        composerResizeFrame: 0,
        thinking: {
          jobId: null,
          index: 0,
          queue: [],
          seenSeq: 0,
          token: 0,
          timer: null,
          transitionTimer: null,
          settledTimer: null,
          running: false,
          startedAt: 0,
        },
      },
    };
  }

  const ctx = root.__askmoinaCtx;
  ctx.component = component;
  ctx.data = component.data || {};
  const state = ctx.state;

  const iconChevron = () => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>';
  const iconCopy = () => '<svg viewBox="0 0 24 24"><rect height="11" rx="2" width="11" x="8" y="8"></rect><path d="M5 16H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1"></path></svg>';

  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;"
  }[char]));

  function formatTime(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const now = new Date();
    return date.toDateString() === now.toDateString()
      ? date.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"})
      : date.toLocaleDateString([], {month:"short", day:"numeric"});
  }

  function showToast(message) {
    const toast = qs("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove("show"), 1500);
  }

  const THINKING_PHRASES = [
    "Thinking through the idea",
    "Exploring a few directions",
    "Connecting the pieces",
    "Working through the details",
    "Shaping a response",
    "Almost there",
    "Verification and Audit Complete",
  ];

  const PHASE_TARGET_INDEX = {
    initializing: 0,
    searching: 1,
    synthesizing: 2,
    sandbox: 3,
    auditing: 4,
    complete: 6,
  };

  function renderHistory(items) {
    const panel = qs("#historyBackdrop");
    if (!panel) return;
    qsa(".history-section.dynamic", panel).forEach(section => section.remove());
    const list = items?.length ? items : [
      {id:"mock-1", title:"Designing a better city", updated_at:"", active:true},
      {id:"mock-2", title:"Product concept", updated_at:"", active:false},
      {id:"mock-3", title:"Interface ideas", updated_at:"", active:false},
    ];
    const section = document.createElement("div");
    section.className = "history-section dynamic";
    section.innerHTML = `<div class="history-section-label">Conversations</div>` + list.map(item => `
      <button class="entry ${item.active ? "selected" : ""}" data-history="${esc(item.id)}">
        <span class="entry-text">${esc(item.title)}</span>
        <span class="entry-time">${esc(formatTime(item.updated_at))}</span>
      </button>
    `).join("");
    panel.querySelector(".history-panel")?.appendChild(section);
  }

  function thinkingMarkup(phrase) {
    return `<div class="thinking visible" data-thinking-row>
      <span class="signal" aria-hidden="true"></span>
      <span class="thinking-phrase" data-thinking-phrase>${esc(phrase)}</span>
    </div>`;
  }

  function renderConversation(data) {
    const empty = qs("#emptyState");
    const conversation = qs("#conversation");
    if (!empty || !conversation) return;

    const messages = data.messages || [];
    const workflow = data.workflow || {};
    const lastUserIndex = messages.reduce((last, message, index) => message.role === "user" ? index : last, -1);
    const revealPending = Boolean(
      workflow.status === "complete" &&
      state.revealPendingJobId &&
      state.revealPendingJobId === workflow.job_id
    );

    empty.style.display = messages.length ? "none" : "flex";
    conversation.classList.toggle("active", messages.length > 0);
    conversation.innerHTML = "";
    if (!messages.length) return;

    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];
      if (message.role !== "user") continue;

      const assistant = messages[i + 1]?.role === "assistant" ? messages[i + 1] : null;
      const isLastUser = i === lastUserIndex;
      const key = `${i}:${message.content.length}`;
      const isLong = message.content.length > 220 || message.content.split(/\s+/).length > 42;
      const expanded = state.expandedPrompts.has(key);
      const showThinking = isLastUser && (
        (workflow.active && workflow.status !== "complete") || revealPending
      );

      const pair = document.createElement("div");
      pair.className = "conversation-pair";
      const currentPhrase = THINKING_PHRASES[state.thinking.index] || THINKING_PHRASES[0];
      pair.innerHTML = `
        <div class="thought-block">
          <div class="thought-rail" aria-hidden="true"></div>
          <div class="thought-content">
            <div class="thought-preview ${isLong && !expanded ? "long-collapsed" : ""}">
              <p class="thought-text ${isLong ? "long" : ""} ${isLong && !expanded ? "collapsed" : ""}" data-thought-text="${esc(key)}"></p>
              ${isLong ? `<button class="thought-toggle ${expanded ? "expanded" : ""}" data-thought-toggle="${esc(key)}" type="button" aria-label="${expanded ? "Collapse thought" : "Expand thought"}" title="${expanded ? "Collapse thought" : "Expand thought"}">${iconChevron()}</button>` : ""}
            </div>
            ${isLong ? `<div class="thought-tools"><button class="thought-tool" data-copy-thought="${esc(key)}" type="button" aria-label="Copy thought" title="Copy thought"><span class="tool-icon" aria-hidden="true">${iconCopy()}</span></button></div>` : ""}
          </div>
        </div>

        ${(assistant || showThinking) ? `<div class="response-wrap">
          <div class="answer-rail" aria-hidden="true"></div>
          <div class="response-content">
            ${showThinking ? thinkingMarkup(currentPhrase) : ""}
            ${assistant ? `<article class="response ${revealPending ? "" : "visible"}">
              <div class="response-body"></div>
              <div class="actions">
                <button class="response-action" data-copy-response type="button">Copy</button>
                <button class="response-action" data-regenerate type="button">Regenerate</button>
                <button class="response-action" data-more type="button">More</button>
              </div>
            </article>` : ""}
          </div>
        </div>` : ""}
      `;

      pair.querySelector("[data-thought-text]").textContent = message.content;

      if (assistant) {
        const body = pair.querySelector(".response-body");
        if (body) body.innerHTML = assistant.html || `<p>${esc(assistant.content)}</p>`;
      }

      conversation.appendChild(pair);
    }
  }

  function renderModes() {
    const busy = Boolean(ctx.data?.workflow?.active);
    qsa(".mode").forEach(mode => {
      const active = mode.dataset.mode === state.mode;
      mode.classList.toggle("active", active);
      mode.classList.toggle("disabled", busy);
      mode.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function messagesKey(messages) {
    return JSON.stringify((messages || []).map(message => [message.role, message.content]));
  }

  function clearThinkingTimers() {
    const t = state.thinking;
    clearTimeout(t.timer);
    clearTimeout(t.transitionTimer);
    clearTimeout(t.settledTimer);
    t.timer = null;
    t.transitionTimer = null;
    t.settledTimer = null;
  }

  function resetThinkingAnimator() {
    const t = state.thinking;
    clearThinkingTimers();
    t.token += 1;
    t.jobId = null;
    t.index = 0;
    t.queue = [];
    t.seenSeq = 0;
    t.running = false;
    t.startedAt = 0;
  }

  function readPhaseEvents(workflow) {
    const t = state.thinking;
    const jobId = workflow.job_id || null;
    const events = Array.isArray(workflow.phase_events) ? [...workflow.phase_events] : [];

    if (!jobId) return;
    if (t.jobId !== jobId) {
      resetThinkingAnimator();
      t.jobId = jobId;
      t.startedAt = performance.now();
    }

    events.sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));
    for (const event of events) {
      const seq = Number(event.seq || 0);
      if (!seq || seq <= t.seenSeq) continue;
      t.seenSeq = seq;
      const target = PHASE_TARGET_INDEX[event.phase];
      if (!Number.isInteger(target)) continue;
      if (target === 6) {
        if (!t.queue.includes(6)) t.queue.push(6);
        continue;
      }
      if (target > t.index && !t.queue.includes(target)) t.queue.push(target);
    }

    // Fallback for any older backend snapshot without phase_events.
    const target = PHASE_TARGET_INDEX[workflow.phase];
    if (Number.isInteger(target) && target > t.index && !t.queue.includes(target)) {
      t.queue.push(target);
    }
  }

  function getPhraseElement() {
    return qs("[data-thinking-phrase]");
  }

  function finishPhraseTransition(token, nextIndex) {
    const t = state.thinking;
    if (token !== t.token) return;
    const phrase = getPhraseElement();
    if (!phrase) return;

    phrase.classList.remove("is-out");
    phrase.classList.add("is-in");
    phrase.textContent = THINKING_PHRASES[nextIndex] || THINKING_PHRASES[0];
    t.index = nextIndex;

    requestAnimationFrame(() => {
      if (token !== t.token) return;
      requestAnimationFrame(() => {
        if (token !== t.token) return;
        phrase.classList.remove("is-in");
        phrase.classList.add("is-resting");
      });
    });

    t.settledTimer = setTimeout(() => {
      if (token !== t.token) return;
      phrase.classList.remove("is-resting");
      scheduleThinkingPump(80);
    }, 280);
  }

  function transitionToPhrase(nextIndex, token) {
    const t = state.thinking;
    if (token !== t.token || nextIndex === t.index) {
      scheduleThinkingPump(80);
      return;
    }
    const phrase = getPhraseElement();
    if (!phrase) {
      scheduleThinkingPump(120);
      return;
    }

    phrase.classList.remove("is-in", "is-resting");
    phrase.classList.add("is-out");

    clearTimeout(t.transitionTimer);
    t.transitionTimer = setTimeout(() => finishPhraseTransition(token, nextIndex), 180);
  }

  function scheduleThinkingPump(delay = 120) {
    const t = state.thinking;
    clearTimeout(t.timer);
    const token = t.token;
    t.timer = setTimeout(() => pumpThinking(token), delay);
  }

  function pumpThinking(token) {
    const t = state.thinking;
    if (token !== t.token || !t.jobId) return;

    const workflow = ctx.data?.workflow || {};
    if (!workflow.active && workflow.status !== "complete") {
      t.running = false;
      return;
    }

    const next = t.queue.shift();
    if (Number.isInteger(next) && next > t.index) {
      t.running = true;
      transitionToPhrase(next, token);
      return;
    }

    // During a long audit, softly alternate the two final thinking phrases.
    if (workflow.status === "running" && t.index >= 4) {
      t.running = true;
      const nextIndex = t.index === 4 ? 5 : 4;
      clearTimeout(t.timer);
      t.timer = setTimeout(() => transitionToPhrase(nextIndex, token), 820);
      return;
    }

    // Completion stays in the same compact status row: Almost there → Audit Complete.
    if (workflow.status === "complete") {
      if (t.index < 5) {
        t.running = true;
        transitionToPhrase(5, token);
        return;
      }
      if (t.index < 6) {
        t.running = true;
        transitionToPhrase(6, token);
        return;
      }
      t.running = false;
      clearTimeout(state.revealTimer);
      state.revealTimer = setTimeout(() => revealResponse(workflow.job_id), 260);
      return;
    }

    t.running = false;
  }

  function startThinkingSequence(workflow) {
    const t = state.thinking;
    if (!workflow.job_id) return;
    readPhaseEvents(workflow);
    if (!t.jobId) return;
    if (!t.running) {
      t.running = true;
      scheduleThinkingPump(80);
    }
  }

  function revealResponse(jobId) {
    if (state.revealPendingJobId !== jobId) return;
    clearTimeout(state.revealTimer);
    resetThinkingAnimator();
    state.revealPendingJobId = null;

    const thinking = qs("[data-thinking-row]");
    const response = qs(".response");

    if (thinking) {
      thinking.classList.add("leaving");
      window.setTimeout(() => thinking.remove(), 280);
    }

    if (response) {
      window.setTimeout(() => response.classList.add("visible"), 90);
    } else {
      renderConversation(ctx.data);
      window.setTimeout(() => qs(".response")?.classList.add("visible"), 90);
    }

    requestAnimationFrame(() => {
      updateComposerGeometry();
      scrollToLatest("smooth");
      ctx.updateScrollLatest?.();
    });

    sendEvent({type:"ui.response_revealed", job_id:jobId});
  }

  function sync(data) {
    ctx.data = data || {};
    state.mode = data.mode || state.mode;
    const workflow = data.workflow || {};
    const currentMessagesKey = messagesKey(data.messages || []);
    const messagesChanged = currentMessagesKey !== state.lastMessagesKey;
    const jobChanged = workflow.job_id && workflow.job_id !== state.workflowJobId;

    state.workflowPhase = workflow.phase || "idle";
    state.workflowJobId = workflow.job_id || null;
    state.workflowStatus = workflow.status || "idle";
    state.lastMessagesKey = currentMessagesKey;

    renderModes();
    renderHistory(data.history || []);

    if (workflow.status === "complete" && workflow.job_id) {
      if (state.revealPendingJobId !== workflow.job_id) {
        state.revealPendingJobId = workflow.job_id;
        if (jobChanged || state.thinking.jobId !== workflow.job_id) {
          resetThinkingAnimator();
          state.thinking.jobId = workflow.job_id;
          state.thinking.startedAt = performance.now();
        }
        renderConversation(data);
        startThinkingSequence(workflow);
        clearTimeout(state.revealTimer);
        // Safety ceiling only. Normal reveal is scheduled after the compact completion phrase settles.
        state.revealTimer = setTimeout(() => revealResponse(workflow.job_id), 2800);
      }
      return;
    }

    if (workflow.status === "error") {
      clearTimeout(state.revealTimer);
      state.revealPendingJobId = null;
      resetThinkingAnimator();
    }

    if (workflow.active) {
      startThinkingSequence(workflow);
    }

    if (messagesChanged) {
      renderConversation(data);
      if (workflow.active || state.revealPendingJobId) {
        // A message append recreates the thinking node; restart the runner against the new DOM.
        state.thinking.running = false;
        scheduleThinkingPump(60);
      }
      if (workflow.active) requestAnimationFrame(() => scrollToLatest("smooth"));
    }

    updateComposerGeometry();
    ctx.updateScrollLatest?.();

    if (data.error && workflow.status === "error") showToast(data.error);
  }

  function openHistory() {
    const backdrop = qs("#historyBackdrop");
    backdrop?.classList.add("open");
    backdrop?.setAttribute("aria-hidden", "false");
  }

  function closeHistory() {
    const backdrop = qs("#historyBackdrop");
    backdrop?.classList.remove("open");
    backdrop?.setAttribute("aria-hidden", "true");
  }

  function resizeInput() {
    const input = qs("#input");
    if (!input) return;
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 220) + "px";
    qs("#sendBtn")?.classList.toggle("disabled", !input.value.trim());
    clearTimeout(state.composerResizeFrame);
    state.composerResizeFrame = requestAnimationFrame(updateComposerGeometry);
  }

  function updateComposerGeometry() {
    const app = qs(".app");
    const wrap = qs(".composer-wrap");
    if (!app || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const gap = window.matchMedia?.("(max-width: 720px)")?.matches ? 22 : 28;
    const viewportGap = Math.max(0, app.clientHeight - rect.top);
    app.style.setProperty("--composer-stack-height", `${Math.ceil(viewportGap)}px`);
    app.style.setProperty("--composer-clearance", `${Math.ceil(viewportGap + gap)}px`);
  }

  function scrollToLatest(behavior = "smooth") {
    const appScroll = qs(".app");
    if (!appScroll) return;
    const scrollNow = () => appScroll.scrollTo({top: appScroll.scrollHeight, behavior});
    scrollNow();
    requestAnimationFrame(scrollNow);
  }

  function submitPrompt() {
    const input = qs("#input");
    if (!input || ctx.data?.workflow?.active) return;
    const value = input.value.trim();
    if (!value) return;
    sendEvent({type:"chat.submit", prompt:value, mode:state.mode});
    scrollToLatest("smooth");
    input.value = "";
    resizeInput();
    showToast("AskMoina is processing");
  }

  if (!root.__askmoinaBound) {
    root.__askmoinaBound = true;

    qsa(".mode").forEach(mode => mode.addEventListener("click", () => {
      if (ctx.data?.workflow?.active) return;
      state.mode = mode.dataset.mode;
      renderModes();
      sendEvent({type:"mode.select", mode:state.mode});
    }));

    qsa(".suggestion").forEach(button => button.addEventListener("click", () => {
      const input = qs("#input");
      if (!input) return;
      input.value = button.dataset.suggestion || "";
      resizeInput();
      input.focus();
    }));

    qs("#input")?.addEventListener("input", resizeInput);
    qs("#input")?.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submitPrompt();
      }
    });

    qs("#sendBtn")?.addEventListener("click", submitPrompt);
    qs("#attachBtn")?.addEventListener("click", () => showToast("Attachment actions are reserved for a future release"));
    qs("#settingsBtn")?.addEventListener("click", () => showToast("Live Search and Sandbox are always on"));
    qs("#historyBtn")?.addEventListener("click", openHistory);
    qs("#closeHistory")?.addEventListener("click", closeHistory);
    qs("#newBtn")?.addEventListener("click", () => { closeHistory(); sendEvent({type:"conversation.new"}); });

    root.addEventListener("click", async event => {
      const toggle = event.target.closest("[data-thought-toggle]");
      if (toggle) {
        const key = toggle.dataset.thoughtToggle;
        state.expandedPrompts.has(key) ? state.expandedPrompts.delete(key) : state.expandedPrompts.add(key);
        renderConversation(ctx.data);
        return;
      }

      const copyThought = event.target.closest("[data-copy-thought]");
      if (copyThought) {
        const key = copyThought.dataset.copyThought;
        const node = root.querySelector(`[data-thought-text="${CSS.escape(key)}"]`);
        if (node) {
          await navigator.clipboard?.writeText(node.textContent || "");
          showToast("Thought copied");
        }
        return;
      }

      const copyResponse = event.target.closest("[data-copy-response]");
      if (copyResponse) {
        const body = copyResponse.closest(".response")?.querySelector(".response-body");
        await navigator.clipboard?.writeText(body?.innerText?.trim() || "");
        showToast("Response copied");
        return;
      }

      if (event.target.closest("[data-regenerate]")) {
        if (ctx.data?.workflow?.active) return;
        sendEvent({type:"chat.regenerate"});
        showToast("AskMoina is processing");
        return;
      }

      if (event.target.closest("[data-more]")) {
        showToast("More actions can be enabled here");
        return;
      }

      const historyEntry = event.target.closest("[data-history]");
      if (historyEntry) {
        const id = historyEntry.dataset.history;
        if (id?.startsWith("mock-")) {
          closeHistory();
          return;
        }
        closeHistory();
        sendEvent({type:"conversation.select", conversation_id:id});
      }
    });

    qs("#historyBackdrop")?.addEventListener("click", event => {
      if (event.target === qs("#historyBackdrop")) closeHistory();
    });

    const appScroll = qs(".app");
    const scrollLatest = qs("#scrollLatest");
    const updateScrollLatest = () => {
      if (!appScroll || !scrollLatest) return;
      const messages = (ctx.data?.messages || []).length;
      const distance = appScroll.scrollHeight - appScroll.scrollTop - appScroll.clientHeight;
      scrollLatest.classList.toggle("visible", messages > 1 && distance > 150);
    };
    appScroll?.addEventListener("scroll", updateScrollLatest, {passive:true});
    scrollLatest?.addEventListener("click", () => appScroll?.scrollTo({top:appScroll.scrollHeight, behavior:"smooth"}));
    window.addEventListener("resize", updateComposerGeometry, {passive:true});
    ctx.updateScrollLatest = updateScrollLatest;
    updateComposerGeometry();

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closeHistory();
    });
  }

  sync(ctx.data);

  return () => {
    clearTimeout(state.revealTimer);
    clearTimeout(state.toastTimer);
    clearTimeout(state.scrollTimer);
    resetThinkingAnimator();
  };
}
