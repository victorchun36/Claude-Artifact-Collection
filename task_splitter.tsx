import { useState, useEffect } from "react";

const TODAY = new Date().toISOString().split("T")[0];

function Spinner() {
  return (
    <svg className="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
    </svg>
  );
}

export default function App() {
  const [date, setDate] = useState(TODAY);
  const [tasks, setTasks] = useState([]);
  const [selected, setSelected] = useState({});
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [splitResults, setSplitResults] = useState({});
  const [stepDone, setStepDone] = useState({});
  const [error, setError] = useState("");
  const [tasksFetched, setTasksFetched] = useState(false);

  const fetchTasks = async () => {
    setLoadingTasks(true);
    setError("");
    setTasks([]);
    setSplitResults({});
    setTasksFetched(false);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: `你是一个 Notion 任务助手。用户会给你一个日期，你需要调用 Notion MCP 工具，从「任务管理中心」数据库中查找该日期的未完成任务（Done? ≠ Done）。
返回 JSON 格式，只返回 JSON，不要有其他文字：
{"tasks": [{"id": "page_id", "title": "任务标题", "priority": "优先级或空字符串", "tag": "标签或空字符串"}]}
如果没有任务，返回 {"tasks": []}`,
          messages: [{ role: "user", content: `请查找 ${date} 当天未完成的任务（Done? ≠ Done）。搜索「任务管理中心」数据库。` }],
          mcp_servers: [{ type: "url", url: "https://mcp.notion.com/mcp", name: "notion-mcp" }]
        })
      });
      const data = await res.json();
      const textBlocks = (data.content || []).filter(b => b.type === "text");
      const raw = textBlocks.map(b => b.text).join("");
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("无法解析 Notion 返回的数据");
      const parsed = JSON.parse(jsonMatch[0]);
      const list = parsed.tasks || [];
      setTasks(list);
      const sel = {};
      list.forEach(t => sel[t.id] = true);
      setSelected(sel);
      setTasksFetched(true);
      if (list.length === 0) setError("今天没有未完成的任务 🎉");
    } catch (e) {
      setError("读取失败：" + e.message);
    } finally {
      setLoadingTasks(false);
    }
  };

  const splitTasks = async () => {
    const toSplit = tasks.filter(t => selected[t.id]);
    if (toSplit.length === 0) { setError("请至少选择一个任务"); return; }
    setSplitting(true);
    setError("");
    setSplitResults({});
    try {
      const taskList = toSplit.map((t, i) => `${i + 1}. ${t.title}`).join("\n");
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: `你是一个帮助用户克服启动阻力和执行阻力的任务教练（task-splitter）。用户会提交一个或多个任务，你的工作是把每个大任务拆解成具体可执行的小步骤，让用户看完就知道"下一步做什么"，不需要再思考。

拆分原则：
1. 粒度：每个步骤控制在 10-15 分钟内，最多不超过 20 分钟。超过则继续拆。
2. 第一步必须极度具体：消除所有模糊性。不写"开始写报告"，写"打开文档，写下报告的三个要点标题"。
3. 动词开头：每个步骤都以行动动词开始（打开、写下、发送、找到、整理……）。
4. 识别可跳过/外包的步骤：如果某个子步骤不是必须由用户本人完成，或者不做也不影响结果，标注出来。
5. 时间估算要现实：宁可估多，不要让用户觉得"做不完"。
6. 语气：温暖、务实，不夸张。鼓励语要简短（一句话），不要说教。

只返回 JSON，不要有任何其他文字或 markdown，格式如下：
{
  "results": [
    {
      "title": "任务标题",
      "totalMinutes": 60,
      "steps": [
        { "label": "第一步（马上能做）", "action": "具体行动描述", "minutes": 5, "tip": "简短鼓励", "first": true },
        { "label": "步骤 2", "action": "具体行动描述", "minutes": 10, "tip": "简短提示", "first": false }
      ],
      "skippable": [
        { "name": "可跳过的步骤名", "reason": "理由一句话" }
      ],
      "orderSuggestion": "多任务时的执行顺序建议（单任务留空字符串）"
    }
  ]
}`,
          messages: [{ role: "user", content: `请用 task-splitter 拆分以下任务：\n${taskList}` }]
        })
      });
      const data = await res.json();
      const raw = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("解析拆分结果失败");
      const parsed = JSON.parse(jsonMatch[0]);
      const results = {};
      (parsed.results || []).forEach((r, i) => {
        const task = toSplit.find(t => t.title === r.title) || toSplit[i];
        if (task) results[task.id] = r;
      });
      setSplitResults(results);
    } catch (e) {
      setError("拆分失败：" + e.message);
    } finally {
      setSplitting(false);
    }
  };

  const toggleSelect = (id) => setSelected(s => ({ ...s, [id]: !s[id] }));
  const allSelected = tasks.length > 0 && tasks.every(t => selected[t.id]);
  const toggleAll = () => {
    const val = !allSelected;
    const s = {};
    tasks.forEach(t => s[t.id] = val);
    setSelected(s);
  };
  const toggleStep = (taskId, i) => {
    const key = `${taskId}-${i}`;
    setStepDone(s => ({ ...s, [key]: !s[key] }));
  };

  const selectedCount = tasks.filter(t => selected[t.id]).length;

  return (
    <div style={{ minHeight: "100vh", background: "#0f0f0f", color: "#e8e8e8", fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif", padding: "32px 24px" }}>
      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .task-card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 14px 16px; margin-bottom: 10px; transition: border-color 0.2s; }
        .task-card:hover { border-color: #444; }
        .task-card.selected { border-color: #555; }
        .step-item { display: flex; align-items: flex-start; gap: 10px; padding: 8px 0; border-bottom: 1px solid #222; cursor: pointer; }
        .step-item:last-child { border-bottom: none; }
        .step-check { width: 18px; height: 18px; border-radius: 50%; border: 2px solid #555; flex-shrink: 0; margin-top: 1px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
        .step-check.done { background: #4ade80; border-color: #4ade80; }
        .btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 20px; border-radius: 10px; border: none; cursor: pointer; font-size: 14px; font-weight: 600; transition: all 0.2s; }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-primary { background: #C86240; color: #fff; }
        .btn-primary:hover:not(:disabled) { background: #b8552e; }
        .btn-secondary { background: #C86240; color: #fff; border: none; }
        .btn-secondary:hover:not(:disabled) { background: #b8552e; }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(1); cursor: pointer; }
        .tag { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 11px; background: #252525; color: #888; margin-left: 8px; }
        .priority-high { color: #f87171; }
        .priority-mid { color: #fbbf24; }
        input[type="date"] { background: #1a1a1a; border: 1px solid #333; color: #e8e8e8; border-radius: 10px; padding: 10px 14px; font-size: 15px; outline: none; width: 100%; box-sizing: border-box; }
        input[type="date"]:focus { border-color: #555; }
        .checkbox { width: 18px; height: 18px; border-radius: 5px; border: 2px solid #444; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.15s; }
        .checkbox.checked { background: #e8e8e8; border-color: #e8e8e8; }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
        <svg width="56" height="48" viewBox="0 0 14 12" xmlns="http://www.w3.org/2000/svg" style={{ imageRendering: "pixelated" }}>
          {/* main body */}
          <rect x="2" y="1" width="10" height="7" fill="#C86240"/>
          {/* left arm */}
          <rect x="0" y="4" width="2" height="2" fill="#C86240"/>
          {/* right arm */}
          <rect x="12" y="4" width="2" height="2" fill="#C86240"/>
          {/* left leg */}
          <rect x="3" y="8" width="2" height="3" fill="#C86240"/>
          {/* right leg */}
          <rect x="9" y="8" width="2" height="3" fill="#C86240"/>
          {/* left eye */}
          <rect x="4" y="3" width="1" height="2" fill="#1a1010"/>
          {/* right eye */}
          <rect x="9" y="3" width="1" height="2" fill="#1a1010"/>
        </svg>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>当日任务拆分器</h1>
      </div>
      <p style={{ color: "#666", fontSize: 14, margin: "0 0 10px" }}>Notion 任务，一键拆分成小步骤</p>

      {/* 日期 + 读取按钮 */}
      <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
        <input type="date" value={date} onChange={e => { setDate(e.target.value); setTasksFetched(false); setTasks([]); setSplitResults({}); }} />
        <button className="btn btn-primary" onClick={fetchTasks} disabled={loadingTasks} style={{ whiteSpace: "nowrap" }}>
          {loadingTasks ? <Spinner /> : null}
          读取任务
        </button>
      </div>
      <div style={{ borderLeft: "3px solid #C86240", paddingLeft: 12, margin: "0 0 24px", textAlign: "left" }}>
        <p style={{ color: "#C86240", fontSize: 20, fontFamily: "Georgia, 'Times New Roman', serif", fontStyle: "italic", margin: 0 }}>千里之行，始于足下。</p>
      </div>

      {error && <div style={{ color: "#f87171", fontSize: 13, marginBottom: 16, padding: "10px 14px", background: "#1f1010", borderRadius: 8, border: "1px solid #3a1515" }}>{error}</div>}

      {/* 任务列表 */}
      {tasks.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div className={`checkbox ${allSelected ? "checked" : ""}`} onClick={toggleAll}>
                {allSelected && <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2.5 2.5L8 3" stroke="#0f0f0f" strokeWidth="1.8" fill="none" strokeLinecap="round"/></svg>}
              </div>
              <span style={{ fontSize: 13, color: "#888" }}>全选（{tasks.length} 个任务）</span>
            </div>
            <span style={{ fontSize: 13, color: "#666" }}>已选 {selectedCount}</span>
          </div>

          {tasks.map(task => (
            <div key={task.id} className={`task-card ${selected[task.id] ? "selected" : ""}`}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div className={`checkbox ${selected[task.id] ? "checked" : ""}`} onClick={() => toggleSelect(task.id)} style={{ marginTop: 2 }}>
                  {selected[task.id] && <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2.5 2.5L8 3" stroke="#0f0f0f" strokeWidth="1.8" fill="none" strokeLinecap="round"/></svg>}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 500 }}>{task.title}</span>
                    {task.priority && <span className={`tag ${task.priority === "高" ? "priority-high" : task.priority === "中" ? "priority-mid" : ""}`}>{task.priority}</span>}
                    {task.tag && <span className="tag">{task.tag}</span>}
                  </div>

                  {/* 拆分步骤 */}
                  {splitResults[task.id] && (() => {
                    const r = splitResults[task.id];
                    return (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 12, color: "#555", marginBottom: 8 }}>预估总时长：{r.totalMinutes} 分钟</div>
                        {(r.steps || []).map((step, i) => {
                          const done = stepDone[`${task.id}-${i}`];
                          return (
                            <div key={i} className="step-item" onClick={() => toggleStep(task.id, i)}>
                              <div className={`step-check ${done ? "done" : ""}`}>
                                {done && <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2.5 2.5L8 3" stroke="#0f0f0f" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>}
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                  {step.first && <span style={{ fontSize: 11, background: "#1a3a1a", color: "#4ade80", borderRadius: 4, padding: "1px 6px" }}>🟢 马上能做</span>}
                                  <span style={{ fontSize: 13, color: done ? "#555" : "#ccc", textDecoration: done ? "line-through" : "none", lineHeight: 1.5 }}>{step.action}</span>
                                  <span style={{ fontSize: 11, color: "#555", whiteSpace: "nowrap" }}>⏱ {step.minutes} 分钟</span>
                                </div>
                                {step.tip && !done && <div style={{ fontSize: 12, color: "#666", marginTop: 3 }}>💬 {step.tip}</div>}
                              </div>
                            </div>
                          );
                        })}
                        {r.skippable?.length > 0 && (
                          <div style={{ marginTop: 8, padding: "8px 10px", background: "#161616", borderRadius: 8 }}>
                            {r.skippable.map((s, i) => (
                              <div key={i} style={{ fontSize: 12, color: "#666" }}>⏭ <span style={{ color: "#888" }}>{s.name}</span> — {s.reason}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          ))}

          <div style={{ marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={splitTasks} disabled={splitting || selectedCount === 0}>
              {splitting ? <Spinner /> : null}
              {splitting ? "拆分中…" : `拆分选中的任务（${selectedCount}）`}
            </button>
          </div>
        </>
      )}

      {tasksFetched && tasks.length === 0 && !error && (
        <div style={{ textAlign: "center", color: "#555", fontSize: 14, padding: "40px 0" }}>今天没有未完成的任务 🎉</div>
      )}
    </div>
  );
}
