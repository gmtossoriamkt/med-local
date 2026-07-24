/*
  Раздел "Библиотека" — med-local.ru
  Логика: загрузка данных, фильтр по категориям, поиск, модальное окно документа.

  ВАЖНО ДЛЯ РАЗРАБОТЧИКА:
  - DATA_URL ниже указывает на статический JSON. На проде замените на реальный
    эндпоинт вашей CMS/API, который отдаёт тот же формат (categories + documents).
  - При открытии документа мы дополнительно меняем URL через history.pushState —
    это даёт каждому документу свой адрес (для SEO и возможности поделиться ссылкой),
    даже когда открывается модалка, а не отдельная страница.
  - Если пользователь заходит сразу по прямой ссылке /biblioteka/{cat}/{doc}/ —
    рекомендуется на сервере отдавать полноценную статическую страницу документа
    (шаблон card-template-example.html), а не только эту SPA-версию — так поисковики
    надёжно проиндексируют контент без выполнения JS.
*/

const DATA_URL = "biblioteka-data.json?v=5";

let state = {
  documents: [],
  categories: [],
  activeCategory: "all",
  query: ""
};

async function init() {
  const res = await fetch(DATA_URL);
  const data = await res.json();
  state.documents = data.documents;
  state.categories = data.categories;
  renderChips();
  renderList();
  bindGlobalEvents();
  handleDeepLink();
}

function renderChips() {
  const chips = document.getElementById("libChips");
  const all = { name: "Все документы", slug: "all", count: state.documents.length };
  const items = [all, ...state.categories];
  chips.innerHTML = items.map(c => `
    <button class="lib-chip${state.activeCategory === c.slug ? " active" : ""}"
            data-slug="${c.slug}" role="tab" aria-selected="${state.activeCategory === c.slug}">
      ${escapeHtml(c.name)} (${c.count})
    </button>
  `).join("");
  chips.querySelectorAll(".lib-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      state.activeCategory = btn.dataset.slug;
      renderChips();
      renderList();
    });
  });
}

function renderList() {
  const list = document.getElementById("libList");
  const empty = document.getElementById("libEmpty");
  const countEl = document.getElementById("libCount");

  const q = state.query.trim().toLowerCase();
  const filtered = state.documents.filter(d => {
    const matchesCategory = state.activeCategory === "all" || d.categorySlug === state.activeCategory;
    const matchesQuery = !q || d.title.toLowerCase().includes(q);
    return matchesCategory && matchesQuery;
  });

  countEl.textContent = `Найдено документов: ${filtered.length}`;

  if (filtered.length === 0) {
    list.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.innerHTML = filtered.map((d, i) => `
    <div class="lib-item">
      <span class="lib-item-icon" aria-hidden="true">&#128196;</span>
      <div class="lib-item-body">
        <p class="lib-item-title">${escapeHtml(d.title)}</p>
        <p class="lib-item-meta">${escapeHtml(d.category)}${d.year ? " · " + d.year : ""}</p>
      </div>
      <button class="lib-item-btn" data-index="${state.documents.indexOf(d)}">
        &#8595; Скачать
      </button>
    </div>
  `).join("");

  list.querySelectorAll(".lib-item-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const doc = state.documents[parseInt(btn.dataset.index, 10)];
      openModal(doc, true);
    });
  });
}

function openModal(doc, updateUrl) {
  document.getElementById("libModalBadge").textContent = `${doc.docType} · ${doc.year || ""}`;
  document.getElementById("libModalTitle").textContent = doc.title;
  document.getElementById("libModalMeta").textContent = doc.category;
  document.getElementById("libModalDownload").href = doc.fileUrl;
  document.getElementById("libModalFullpage").href = doc.pageUrl;
  document.getElementById("libModalOverlay").hidden = false;
  document.body.style.overflow = "hidden";

  if (updateUrl) {
    history.pushState({ docPage: doc.pageUrl }, "", doc.pageUrl);
  }
}

function closeModal(updateUrl) {
  document.getElementById("libModalOverlay").hidden = true;
  document.body.style.overflow = "";
  if (updateUrl) {
    history.pushState({}, "", "/biblioteka/");
  }
}

function handleDeepLink() {
  // Если пользователь открыл /biblioteka/{cat}/{doc}/ напрямую —
  // сразу показываем модалку с этим документом поверх списка.
  const path = window.location.pathname;
  const doc = state.documents.find(d => d.pageUrl === path);
  if (doc) {
    openModal(doc, false);
  }
}

function bindGlobalEvents() {
  document.getElementById("libSearch").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderList();
  });

  document.getElementById("libModalClose").addEventListener("click", () => closeModal(true));
  document.getElementById("libModalOverlay").addEventListener("click", (e) => {
    if (e.target.id === "libModalOverlay") closeModal(true);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("libModalOverlay").hidden) closeModal(true);
  });
  window.addEventListener("popstate", () => {
    if (window.location.pathname === "/biblioteka/") {
      closeModal(false);
    } else {
      handleDeepLink();
    }
  });

  const askLink = document.getElementById("libModalAsk");
  if (askLink) {
    askLink.addEventListener("click", (e) => {
      e.preventDefault();
      closeModal(true);
      setTimeout(() => {
        const target = document.getElementById("libAsk");
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 150);
    });
  }

  const askForm = document.getElementById("libAskForm");
  if (askForm) {
    askForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = askForm.querySelector(".lib-ask-submit");
      const successEl = document.getElementById("libAskSuccess");
      const errorEl = document.getElementById("libAskError");
      successEl.hidden = true;
      errorEl.hidden = true;
      submitBtn.disabled = true;
      submitBtn.textContent = "Отправляем...";

      try {
        const res = await fetch("https://formspree.io/f/mrewovkk", {
          method: "POST",
          headers: { "Accept": "application/json" },
          body: new FormData(askForm)
        });
        if (res.ok) {
          successEl.hidden = false;
          askForm.reset();
        } else {
          errorEl.hidden = false;
        }
      } catch (err) {
        errorEl.hidden = false;
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Задать вопрос";
      }
    });
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", init);
