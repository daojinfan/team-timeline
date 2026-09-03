---
doc_id: ARC-AUTH-RBAC-001
type: architecture.security.auth-rbac
status: implemented
version: 1.1
owner: human
baseline: BL-011
depends_on:
  - REQ-V5-001
  - ARC-OVERALL-V5-001
  - ARC-COMP-V5-001
affects:
  - public/index.html
  - public/app.js
  - public/styles.css
  - src/request-context.js
  - src/server.js
  - src/v3/index.js
supersedes: null
last_reviewed: 2026-09-03
---

# 用户认证与双角色权限模块详设

## 1. 设计目标

为当前 Node.js + SQLite 单体 Web 应用增加登录认证和两级权限：

- 管理员（`admin`）：拥有完整管理权限；
- 普通用户（`viewer`）：只能查看，不能修改业务数据。

权限必须由后端强制执行。前端隐藏或禁用按钮只用于改善体验，不能作为安全边界。

## 2. 范围与边界

### 2.1 本次范围

- 用户登录、退出和当前会话查询；
- 管理员和普通用户两个角色；
- 现有 V2/V3/V5 查询接口的登录保护；
- 现有业务写接口的管理员保护；
- 管理员创建、停用和维护系统用户；
- 登录会话、密码哈希和操作审计；
- 局域网部署所需的认证能力。

### 2.2 不在本次范围

- 多租户和组织级数据隔离；
- 细粒度到单个任务的授权；
- 第三方 OAuth、LDAP 或企业单点登录；
- 手机端专用权限模型；
- 多实例高可用和跨服务器 Session 共享。

现有 V5 需求曾将登录权限列为范围外。本设计属于独立的安全增强模块，不改变已有任务、专题、样品和成员的数据语义。

## 3. 核心概念

系统用户与业务成员分离：

```text
系统用户 users
  ├─ admin    管理员
  └─ viewer   普通用户

业务成员 members
  └─ 继续用于任务参与、排期和负载统计
```

业务成员可以没有登录账号；登录用户也不必是任务参与成员。

## 4. 角色与权限

### 4.1 管理员 `admin`

管理员可以：

- 查看所有任务、专题、样品、成员、甘特图和负载；
- 新增、编辑、删除、归档、恢复任务、专题、样品和成员；
- 修改任务排期和成员排期；
- 修改工作区默认状态；
- 导入、导出、备份和恢复；
- 创建、停用和修改系统用户；
- 查看操作审计日志。

### 4.2 普通用户 `viewer`

普通用户可以：

- 登录和退出；
- 查看所有业务模块；
- 搜索、筛选、排序；
- 查看任务详情、甘特图和负载；
- 导出 CSV。

普通用户不能：

- 新增、编辑、删除、归档或恢复业务数据；
- 修改任务或成员排期；
- 修改工作区默认状态；
- 导入数据或恢复数据库；
- 管理系统用户；
- 查看审计日志。

### 4.3 权限矩阵

| 功能 | admin | viewer |
| --- | --- | --- |
| 登录、退出 | ✓ | ✓ |
| 查看任务、专题、样品、成员 | ✓ | ✓ |
| 搜索、筛选、排序 | ✓ | ✓ |
| 甘特图和负载 | ✓ | ✓ |
| 导出 CSV | ✓ | ✓ |
| 新增业务数据 | ✓ | ✕ |
| 编辑任务、资源和排期 | ✓ | ✕ |
| 归档、恢复、删除 | ✓ | ✕ |
| 修改默认状态 | ✓ | ✕ |
| 导入数据 | ✓ | ✕ |
| 数据库备份 | ✓ | ✕ |
| 数据库恢复 | ✓ | ✕ |
| 用户管理 | ✓ | ✕ |
| 审计日志 | ✓ | ✕ |

## 5. 总体架构

```text
浏览器
  ↓ 登录接口
Session Cookie
  ↓
认证中间件 authenticateRequest()
  ↓
权限中间件 authorize(user, action)
  ↓
现有 V2/V3/V5 API
  ↓
SQLite
```

请求处理规则：

```text
未登录                         → 401 Unauthorized
已登录 viewer 访问 GET         → 正常返回
已登录 viewer 访问写接口       → 403 Forbidden
已登录 admin 访问允许的接口    → 正常执行并记录审计
```

认证中间件应位于 `src/server.js` 的统一请求入口，业务路由不自行实现登录判断。V3/V5 路由函数接收已经确认过的 `requestContext.user`。

## 6. 数据模型

认证表独立于现有 V2/V3/V5 业务表，采用增量迁移，不改变既有业务 schema checksum。

### 6.1 `users`

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

约束：

- `username` 不区分大小写时应在应用层统一规范化；
- 至少保留一个启用中的管理员；
- 不允许管理员停用自己；
- 不允许普通用户自行注册。

### 6.2 `sessions`

```sql
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
```

服务端只保存 Token 哈希，不保存浏览器 Cookie 中的原始 Token。

### 6.3 `audit_log`

```sql
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  before_json TEXT,
  after_json TEXT,
  result TEXT NOT NULL,
  ip_address TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX idx_audit_log_user_id ON audit_log(user_id, created_at DESC);
```

审计记录不得包含密码、Session Token 或其他凭据。

## 7. 认证接口

### 7.1 登录

```http
POST /api/auth/login
Content-Type: application/json
```

请求：

```json
{
  "username": "admin",
  "password": "用户输入的密码"
}
```

成功时返回当前用户并设置 HttpOnly Cookie：

```http
200 OK
Set-Cookie: session=<opaque-token>; HttpOnly; SameSite=Lax
```

```json
{
  "user": {
    "id": 1,
    "username": "admin",
    "display_name": "系统管理员",
    "role": "admin"
  }
}
```

用户名不存在和密码错误统一返回 `401 Unauthorized`，避免泄露账号是否存在。

### 7.2 当前用户

```http
GET /api/auth/me
```

未登录返回 `401`，已登录返回用户基本信息和角色。

### 7.3 退出

```http
POST /api/auth/logout
```

服务端删除当前 Session，客户端清除 Cookie。

### 7.4 首次登录改密

```http
POST /api/auth/change-password
```

请求体包含 `current_password` 和 `new_password`。管理员通过环境变量引导创建、管理员
重置密码或新建用户后，`must_change_password=1`；除当前用户查询、退出和本接口外，
其他接口均返回 `PASSWORD_CHANGE_REQUIRED`，直到新密码保存成功。

## 8. 管理员用户接口

以下接口只允许 `admin`：

```http
GET    /api/admin/users
POST   /api/admin/users
PUT    /api/admin/users/:id
POST   /api/admin/users/:id/reset-password
POST   /api/admin/users/:id/disable
POST   /api/admin/users/:id/enable
GET    /api/admin/audit-log
```

创建用户请求示例：

```json
{
  "username": "zhangsan",
  "display_name": "张三",
  "role": "viewer",
  "password": "由管理员设置的一次性密码"
}
```

密码重置后将 `must_change_password` 设为 `1`，用户下次登录必须修改密码。实现同时接受
`temporary_password` 作为 `password` 的兼容别名。

## 9. 现有业务接口策略

### 9.1 登录后可读接口

所有登录用户均可访问：

```text
GET /api/v2/*
GET /api/v3/*
GET /api/v5/*
GET /api/export/tasks.csv
GET /api/export/member-load.csv
```

### 9.2 管理员写接口

以下方法默认只允许管理员：

```text
POST /api/v2/*
PUT  /api/v2/*
POST /api/v3/*
PUT  /api/v3/*
POST /api/v5/*
PUT  /api/v5/*
DELETE /api/*
```

以下 GET 接口虽然是读取方法，也只允许管理员：

```text
GET /api/backup
GET /api/admin/*
GET /api/audit/*
```

健康检查可以不登录，但不得返回业务数据：

```http
GET /api/health
```

## 10. 后端实现要求

### 10.1 请求上下文

统一生成：

```js
requestContext = {
  user: { id, username, displayName, role },
  sessionId,
  requestId,
  ipAddress
};
```

业务逻辑只从 `requestContext.user` 获取操作者身份。客户端传入的 `actor`、`submitted_by` 或类似字段不能用于授权和审计身份判断。

### 10.2 权限判断

建议使用集中式策略：

```js
authorize(context, "task:read");
authorize(context, "task:write");
authorize(context, "user:manage");
```

角色与动作的映射集中维护，避免在每个路由中散落字符串判断。

### 10.3 错误响应

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "当前账号没有执行此操作的权限"
  }
}
```

不得通过错误信息泄露用户是否存在、密码是否正确或管理员账号名称。

## 11. 前端设计

### 11.1 初始化流程

1. 页面加载；
2. 请求 `GET /api/auth/me`；
3. 未登录时显示登录界面，不加载业务数据；
4. 登录成功后再加载现有 dashboard 数据；
5. 任意业务请求收到 `401` 时回到登录界面。

### 11.2 普通用户只读模式

普通用户登录后：

- 隐藏或禁用新增、编辑、删除、归档、恢复按钮；
- 隐藏导入、恢复、默认状态配置和用户管理入口；
- 保留查看、搜索、筛选、排序和导出；
- 页面顶部显示当前账号和“只读模式”。

前端状态不能决定真实权限，所有写接口仍由后端返回 `403`。

### 11.3 管理员界面

管理员显示完整操作入口，并增加“系统用户”和“操作审计”入口。普通用户不加载审计
记录，也不能通过直接调用接口绕过只读界面。

## 12. 密码与 Session 安全

- 密码使用 Argon2id；若不增加依赖，使用 Node.js 内置 `scrypt`；
- 不保存明文密码；
- Session Token 使用高强度随机值；
- Cookie 使用 `HttpOnly`、`SameSite=Lax`；
- HTTPS 环境增加 `Secure`；
- 空闲 8 小时过期，绝对有效期 7 天；
- 登录失败限流；
- 退出登录立即删除 Session；
- 不在日志中记录密码和原始 Session Token；
- 管理员初始密码必须首次登录修改。

## 13. 数据迁移与初始化

现有数据库升级流程：

1. 启动时检查认证表是否存在；
2. 缺失时执行幂等的 Auth Schema 迁移；
3. 不修改现有任务、专题、样品和成员数据；
4. 如果没有启用中的管理员，进入初始化状态；
5. 通过一次性环境变量或 CLI 命令创建第一个管理员；
6. 初始化完成后关闭初始化入口；
7. 后续所有业务写操作要求管理员登录。

不允许使用固定的默认账号密码，也不允许把初始化密码写入日志。

## 14. 部署要求

第一阶段建议部署在局域网或 VPN 内，不直接暴露公网。

```text
浏览器
  ↓ HTTPS 或内网访问
Nginx/Caddy
  ↓ 本机 3000
Node.js 应用
  ↓
SQLite 数据库
```

部署必须保证：

- Node.js 版本满足项目要求；
- SQLite 文件位于持久化目录；
- 数据库有定期备份；
- 服务以 systemd、PM2 或 Windows 服务方式常驻；
- 公网部署必须使用 HTTPS；
- 公网部署前必须确认认证和权限测试全部通过。

## 15. 测试设计

### 15.1 认证测试

- 未登录访问业务接口返回 `401`；
- 正确密码登录成功；
- 错误密码统一失败；
- 退出后 Session 失效；
- 过期 Session 失效；
- 停用用户无法继续使用旧 Session。

### 15.2 权限测试

- viewer 可以访问所有允许的 GET 接口；
- viewer 调用任意新增、编辑、删除接口返回 `403`；
- viewer 伪造 `actor` 不能绕过权限；
- admin 可以完成现有业务编辑操作；
- viewer 不能调用用户管理、备份和恢复接口；
- 直接使用 curl 调用 API 与前端行为保持一致。

### 15.3 审计测试

- 管理员写操作生成审计记录；
- 审计记录使用真实登录用户；
- 记录操作前后摘要和结果；
- 审计记录不包含密码或 Session Token。

### 15.4 回归测试

- 现有业务测试全部通过；
- 现有 V2/V3/V5 数据和接口返回结构不被破坏；
- 数据库迁移可以重复执行；
- 服务器重启后用户和 Session 策略符合设计。

## 16. 实施阶段

### 阶段一：最小权限闭环

- 认证表和迁移；
- 登录、退出、当前用户接口；
- 认证和权限中间件；
- viewer 只读限制；
- admin 写操作；
- 基础权限测试。

### 阶段二：用户管理与审计

- 管理员用户管理页面；
- 创建、停用、启用用户；
- 修改角色和密码；
- 审计日志页面；
- 登录失败限流。

### 阶段三：生产部署安全

- HTTPS 和反向代理；
- 服务常驻与日志轮转；
- 自动备份与恢复演练；
- 健康检查和运行监控；
- 公网访问策略评估。

## 17. 验收标准

1. 未登录用户无法读取业务数据；
2. 普通用户可以完整浏览系统；
3. 普通用户通过界面和直接 API 都不能修改数据；
4. 管理员可以执行现有全部业务操作；
5. 客户端不能伪造操作者身份；
6. 管理员写操作都有审计记录；
7. 现有业务数据和任务成员关系不受影响；
8. 数据库迁移可重复执行且不破坏既有 schema；
9. Session Cookie 满足安全属性；
10. 现有业务测试和新增权限测试全部通过。

## 18. 默认决策

- 账号由管理员创建，不开放注册；
- 普通用户默认允许导出，不允许备份恢复；
- 使用服务端 Session，不使用第一版 JWT；
- 认证表独立于业务 schema；
- 先支持局域网/VPN，再评估公网部署；
- 细粒度数据权限暂不实现，所有登录用户默认可读全部业务数据。
