export const complexMermaidSamples = [
  {
    id: 'flow', title: '发布流程：子图、分支与反馈回路',
    note: '包含资料检查、并行验证、失败重试和发布后的回滚分支。',
    source: `flowchart TD
  A[收到变更] --> B{资料完整？}
  B -->|否| C[补充说明]
  C --> A
  B -->|是| D[建立候选版本]
  subgraph checks[并行验证]
    D --> E[单元测试]
    D --> F[浏览器检查]
    D --> G[导出检查]
    E --> H{全部通过？}
    F --> H
    G --> H
  end
  H -->|否| I[修正问题]
  I --> D
  H -->|是| J[发布候选版本]
  J --> K[观察运行状态]
  K --> L{指标正常？}
  L -->|是| M[完成发布]
  L -->|否| N[回滚版本]
  N --> I`
  },
  {
    id: 'pie', title: '八分类饼图：数值、百分比与图例',
    note: '八个扇区共计 100，检查分类颜色能否清楚区分，以及深浅模式下文字是否可读。',
    source: `pie showData
  title 文档内容构成
  "技术说明" : 24
  "流程图" : 19
  "数据表格" : 15
  "操作指南" : 12
  "设计方案" : 10
  "会议记录" : 8
  "参考资料" : 7
  "其他内容" : 5`
  },
  {
    id: 'sequence', title: '时序图：四个参与者、循环与异常分支',
    note: '模拟一次带权限检查、异步任务和失败恢复的文档导出。',
    source: `sequenceDiagram
  autonumber
  participant U as 用户
  participant E as 编辑器
  participant R as 渲染服务
  participant S as 文件系统
  U->>E: 发起导出
  E->>R: 读取当前文档快照
  activate R
  R->>S: 检查图片资源
  S-->>R: 返回资源列表
  loop 逐个处理图表
    R->>R: 解析源码并布局
    Note right of R: 保留作者定义的样式
  end
  alt 全部资源可用
    R->>S: 写入导出文件
    S-->>R: 写入成功
    R-->>E: 返回文件位置
    E-->>U: 显示导出结果
  else 资源缺失
    R-->>E: 返回缺失资源明细
    E-->>U: 提示补充资源
  end
  deactivate R`
  },
  {
    id: 'er', title: 'ER 图：五个实体与多种关系',
    note: '包含主键、外键、字段类型和一对多关系，检查细节在导出中是否保留。',
    source: `erDiagram
  WORKSPACE ||--o{ DOCUMENT : contains
  DOCUMENT ||--o{ DIAGRAM : embeds
  DOCUMENT ||--o{ EXPORT : generates
  DOCUMENT }o--o{ TAG : classified
  WORKSPACE {
    string id PK
    string name "工作区名称"
    string root "资源根目录"
  }
  DOCUMENT {
    string id PK
    string workspace_id FK
    string title "文档标题"
    datetime updated_at "更新时间"
  }
  DIAGRAM {
    string id PK
    string document_id FK
    string kind "图表类型"
    string source "源码内容"
  }
  EXPORT {
    string id PK
    string document_id FK
    string format "导出格式"
    string status "处理状态"
  }
  TAG {
    string id PK
    string label "分类名称"
  }`
  },
  {
    id: 'state', title: '状态图：嵌套状态与取消恢复',
    note: '同时展示编辑、渲染和导出状态，以及取消与失败后的恢复路径。',
    source: `stateDiagram-v2
  [*] --> Editing
  state "编辑中" as Editing
  state "处理任务" as Processing {
    [*] --> Parsing
    state "解析源码" as Parsing
    state "布局图表" as Layout
    state "生成文件" as Writing
    Parsing --> Layout: 语法有效
    Layout --> Writing: 布局完成
    Writing --> [*]: 写入成功
  }
  state "完成" as Completed
  state "需要修正" as Failed
  Editing --> Processing: 发起导出
  Processing --> Completed: 任务完成
  Processing --> Failed: 处理失败
  Processing --> Editing: 用户取消
  Failed --> Editing: 修改内容
  Completed --> Editing: 继续编辑
  Completed --> [*]`
  }
];

export const complexMermaidMarkdown = '# Mermaid 复杂图表导出样例\n\n'
  + '同一份源码用于 HTML、PDF 和 Word 导出；配色采用 Catppuccin 官方色值。\n\n'
  + complexMermaidSamples.map(sample => `## ${sample.title}\n\n${sample.note}\n\n\`\`\`mermaid\n${sample.source}\n\`\`\``).join('\n\n');
