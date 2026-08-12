const workflowData = {
  open: {
    number: "01 / 05",
    title: "打开文献",
    copy: "把当前真正想理解的文献带进桌面阅读工作台。"
  },
  core: {
    number: "02 / 05",
    title: "看见核心",
    copy: "从你最想知道的内容开始，建立对论文主线的第一层理解。"
  },
  explore: {
    number: "03 / 05",
    title: "选择深入",
    copy: "选中词句或尚未展开的板块，沿着问题进入下一层。"
  },
  verify: {
    number: "04 / 05",
    title: "核对依据",
    copy: "辨认内容依据，并回到相关原文位置核对上下文。"
  },
  keep: {
    number: "05 / 05",
    title: "留下理解",
    copy: "批注、整理、导出或分享这一轮阅读形成的理解。"
  }
};

const resultData = {
  thin: {
    kicker: "从问题开始",
    title: "薄读",
    copy: "先读懂你最想知道的，再沿词句、板块和关联线索逐层探索。",
    use: "适合：快速进入一篇复杂文献",
    className: "result-thin-preview",
    ariaLabel: "从用户问题逐层深入的薄读预览",
    markup: `
      <div class="thin-toolbar"><span>薄读</span><span>从你的问题开始</span></div>
      <p>为什么这项方法能在更少计算量下保留关键关系？</p>
      <div class="thin-tokens"><span>查看方法依据</span><span>理解实验结果</span><span>继续探索局限</span></div>`
  },
  graph: {
    kicker: "看见联系",
    title: "关系图",
    copy: "把当前内容与概念、证据和相关文献之间的联系放在同一视野中。",
    use: "适合：追踪概念与研究脉络",
    className: "result-graph-preview",
    ariaLabel: "概念、证据和相关文献关系图预览",
    markup: `<img class="result-visual" src="assets/map-visual.svg" alt="当前问题与概念、证据和相关文献组成的关系图" />`
  },
  visual: {
    kicker: "换一种方式理解",
    title: "图表与示意",
    copy: "用结构图、公式、图表或过程演示，把复杂内容变成可以观察和操作的解释。",
    use: "适合：理解结构、数量与过程",
    className: "result-visual-preview",
    ariaLabel: "图表、公式和过程示意预览",
    markup: `
      <div class="visual-explanation" aria-hidden="true">
        <div class="visual-formula">输入 <span>&#8594;</span> 关系提取 <span>&#8594;</span> 证据核对</div>
        <div class="visual-bars"><span style="--value: 42%"></span><span style="--value: 68%"></span><span style="--value: 84%"></span></div>
      </div>
      <p class="preview-caption">结构、数量与过程在同一解释中相互对应</p>`
  },
  compare: {
    kicker: "并列判断",
    title: "对比表",
    copy: "把多篇文献的研究对象、方法、证据和结论放在同一视野中比较。",
    use: "适合：综述与方案比较",
    className: "result-compare-preview",
    ariaLabel: "多篇文献对比表预览",
    markup: `
      <table class="comparison-preview">
        <caption class="sr-only">三篇示例文献的方法与证据对比</caption>
        <thead><tr><th>文献</th><th>研究重点</th><th>证据</th></tr></thead>
        <tbody><tr><th>A</th><td>效率</td><td>消融实验</td></tr><tr><th>B</th><td>表达能力</td><td>基准测试</td></tr><tr><th>C</th><td>可解释性</td><td>案例分析</td></tr></tbody>
      </table>`
  },
  document: {
    kicker: "带走这一轮理解",
    title: "汇报与文档",
    copy: "把阅读结果整理为汇报结构或可继续编辑、保存的文档。",
    use: "适合：组会、课堂与研究记录",
    className: "result-document-preview",
    ariaLabel: "汇报结构与可编辑文档预览",
    markup: `
      <div class="document-preview">
        <p class="document-preview__eyebrow">LITEASY / READING NOTES</p>
        <h4>研究问题与当前判断</h4>
        <p>整理核心理解、依据、关联文献与下一步问题。</p>
        <div class="document-preview__lines"><span></span><span></span><span></span></div>
        <p class="document-preview__formats">DOCX · PDF · Markdown</p>
      </div>`
  }
};

const header = document.querySelector("[data-header]");
const menuButton = document.querySelector("[data-menu-toggle]");
const navigation = document.querySelector("[data-site-nav]");

window.addEventListener("scroll", () => {
  header.classList.toggle("is-scrolled", window.scrollY > 24);
}, { passive: true });

menuButton.addEventListener("click", () => {
  const isOpen = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!isOpen));
  navigation.classList.toggle("is-open", !isOpen);
});

navigation.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    menuButton.setAttribute("aria-expanded", "false");
    navigation.classList.remove("is-open");
  });
});

const workflowButtons = [...document.querySelectorAll("[data-step]")];
const workflowTitle = document.querySelector("[data-workflow-title]");
const workflowCopy = document.querySelector("[data-workflow-copy]");
const workflowNumber = document.querySelector(".step-number");
const workflowMedia = document.querySelector("[data-workflow-media]");
const workflowPanel = document.querySelector("#workflow-panel");

function updateWorkflow(step) {
  const data = workflowData[step];
  workflowButtons.forEach((button) => {
    const active = button.dataset.step === step;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  workflowNumber.textContent = data.number;
  workflowTitle.textContent = data.title;
  workflowCopy.textContent = data.copy;
  workflowMedia.dataset.focus = step;
  workflowPanel.setAttribute("aria-labelledby", `step-${step}`);
}

workflowButtons.forEach((button) => {
  button.addEventListener("click", () => updateWorkflow(button.dataset.step));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = workflowButtons.indexOf(button);
    const direction = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (currentIndex + direction + workflowButtons.length) % workflowButtons.length;
    workflowButtons[nextIndex].focus();
    updateWorkflow(workflowButtons[nextIndex].dataset.step);
  });
});

const resultButtons = [...document.querySelectorAll("[data-result]")];
const resultKicker = document.querySelector("[data-result-kicker]");
const resultTitle = document.querySelector("[data-result-title]");
const resultCopy = document.querySelector("[data-result-copy]");
const resultUse = document.querySelector("[data-result-use]");
const resultPreview = document.querySelector("[data-result-preview]");
const resultPanel = document.querySelector("#result-panel");

function updateResult(result) {
  const data = resultData[result];
  resultButtons.forEach((button) => {
    const active = button.dataset.result === result;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  resultKicker.textContent = data.kicker;
  resultTitle.textContent = data.title;
  resultCopy.textContent = data.copy;
  resultUse.textContent = data.use;
  resultPreview.className = `artifact-preview result-preview ${data.className}`;
  resultPreview.innerHTML = data.markup;
  resultPreview.setAttribute("aria-label", data.ariaLabel);
  resultPanel.setAttribute("aria-labelledby", `result-${result}`);
}

resultButtons.forEach((button) => {
  button.addEventListener("click", () => updateResult(button.dataset.result));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = resultButtons.indexOf(button);
    const direction = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (currentIndex + direction + resultButtons.length) % resultButtons.length;
    resultButtons[nextIndex].focus();
    updateResult(resultButtons[nextIndex].dataset.result);
  });
});

const waitlistUrl = window.LITEASY_WAITLIST_URL || "";
const waitlistForm = document.querySelector("[data-waitlist-form]");
const formStatus = document.querySelector("[data-form-status]");

waitlistForm.addEventListener("submit", (event) => {
  if (waitlistUrl) {
    waitlistForm.action = waitlistUrl;
    waitlistForm.method = "get";
    return;
  }
  event.preventDefault();
  formStatus.textContent = "体验申请入口尚未开放。开放后可在这里提交申请。";
});
