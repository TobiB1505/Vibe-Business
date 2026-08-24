# 0051 - Project shell context ownership and scroll model

Status: Accepted

Date: 2026-08-24

## Context

The project shell still carried the workspace's first technical header after
the project pages themselves had moved to the new product design. Every route
therefore repeated the project name, repository, default branch and connection
state above its own title. That header was sticky, covered content while the
document moved beneath it, and left account navigation outside the project
rail. The result looked and behaved like one dashboard nested inside another.

The project rail already has enough context to identify the open product. The
account level already has canonical Profile, Account settings, Billing and Sign
out destinations. Keeping those facts in both the rail and a persistent content
header creates two owners for the same context and no clear owner for scrolling.

## Decision

The project rail is the sole owner of project identity and project-level
navigation. It contains the current product and stored repository connection,
a bounded switcher showing at most four sibling products, a permanent `View all
products` route, `All products`, the project destinations, and the canonical
account disclosure at its foot. `Project Settings` remains distinct from
account settings.

At the large breakpoint, the shell is one viewport-high flex frame. The 256px
rail remains in place and the project document is the only vertical scroll
surface. The content header is not sticky. Every route renders a quiet
`My Products / Product` breadcrumb followed by one route-owned H1, description
and local actions in normal document flow. Repository and branch details remain
available from the switcher, My Product sources, Repositories and Project
Settings rather than repeating above every project page.

The switcher read is explicitly bounded and optional. Failure leaves the
current product and complete products index reachable; it never takes down the
workspace. Connection copy reflects the stored project connection and does not
perform a live GitHub reachability probe in shared chrome.

Business Health remains canonical project Home under ADR 0047. This decision
changes no route ownership, domain state, provider, paid operation or approval
semantics.

## Consequences

**Easier.** Every project page starts with its own job instead of repository
metadata. Product switching, leaving the project, project configuration and
account configuration each have one stable place. Long project pages scroll
without content passing under a large sticky block.

**Harder.** The project layout pays for one bounded sibling-project read and one
account identity row. Both are constant or explicitly limited, and both degrade
without blocking the current project.

**Foreclosed.** A project route may not add a second persistent project header
or move account settings into project navigation. A future compact sticky bar
would require a new explicit shell decision rather than a page-local class.
