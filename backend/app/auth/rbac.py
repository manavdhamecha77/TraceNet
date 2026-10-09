"""Role-based access control for TraceNet: two roles, enforced centrally.

- Roles and password / token handling: app.auth.security (ROLES = operator, admin)
- Who may call which endpoint: app.auth.policy (public / any user / admin)
- Enforcement on every request: app.auth.middleware.auth_middleware
- Accounts: app.api.auth (login, users API) and `python -m app.auth.users` (CLI)
"""

from app.auth.middleware import actor_name, auth_enabled, current_user  # noqa: F401
from app.auth.policy import ADMIN, ADMIN_COPILOT_TOOLS, PUBLIC, USER, required_access  # noqa: F401
from app.auth.security import ROLES  # noqa: F401
