#!/usr/bin/env bash
#
# stagehand — CLI for managing Stagehand worktrees from the terminal.
#
# Usage: stagehand [--repo <path>] <command> [args...]
#
# Commands:
#   create   <name> [--description "..."]   Create a new worktree + branch
#   list                                     List all Stagehand worktrees
#   path     <branch>                        Print worktree path
#   status   <branch>                        git status in worktree
#   diff     <branch>                        git diff in worktree
#   log      <branch> [-n <count>]           git log in worktree
#   commit   <branch> -m "message"           Stage all + commit in worktree
#   merge    <branch> [--into <base>]        Merge branch into base
#   conflicts <branch> [--with <base>]       Check for merge conflicts
#   delete   <branch> [--keep-branch]        Remove worktree (+ branch)
#   exec     <branch> [--] <command...>      Run command in worktree dir
#
# Global flags:
#   --repo <path>   Target a specific repo (default: auto-detect from CWD)
#

set -euo pipefail

# ---------------------------------------------------------------------------
# Dependency check
# ---------------------------------------------------------------------------

if ! command -v jq &>/dev/null; then
  echo "error: jq is required but not found. Install it: brew install jq" >&2
  exit 1
fi

if ! command -v git &>/dev/null; then
  echo "error: git is required but not found." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Global flag parsing (--repo)
# ---------------------------------------------------------------------------

REPO_ROOT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO_ROOT="$2"
      shift 2
      ;;
    --repo=*)
      REPO_ROOT="${1#--repo=}"
      shift
      ;;
    *)
      break
      ;;
  esac
done

if [[ -z "$REPO_ROOT" ]]; then
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
    echo "error: not inside a git repository (use --repo <path>)" >&2
    exit 1
  }
fi

if [[ ! -d "$REPO_ROOT/.git" && ! -f "$REPO_ROOT/.git" ]]; then
  echo "error: not a git repository: $REPO_ROOT" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Directory conventions (must match electron/services/workspace/git.ts)
# ---------------------------------------------------------------------------

REPO_NAME="$(basename "$REPO_ROOT")"
[[ -z "$REPO_NAME" ]] && REPO_NAME="repo"
WORKTREES_ROOT="$HOME/.stagehand/worktrees/${REPO_NAME}-stagehand-worktrees"
METADATA_FILE="$WORKTREES_ROOT/.stagehand-workspaces.json"

# ---------------------------------------------------------------------------
# Ported functions from git.ts
# ---------------------------------------------------------------------------

# titleToBranchSlug: convert a user-provided name to a valid git branch slug.
# Mirrors electron/services/workspace/git.ts:titleToBranchSlug exactly.
# Uses character-by-character processing to match the TypeScript implementation.
title_to_branch_slug() {
  local title="$1"
  # Trim leading/trailing whitespace
  title="${title#"${title%%[![:space:]]*}"}"
  title="${title%"${title##*[![:space:]]}"}"

  local mapped=""
  local i=0
  local len=${#title}

  while (( i < len )); do
    local c="${title:$i:1}"
    case "$c" in
      ' '|$'\t') mapped+="-" ;;
      '~'|'^'|':'|'?'|'*'|'['|'\\'|'@'|'{'|'"'|'<'|'>'|'|') mapped+="_" ;;
      [a-zA-Z0-9_/\-]) mapped+="$c" ;;
      *) mapped+="-" ;;
    esac
    (( i++ ))
  done

  # Lowercase
  mapped="$(echo "$mapped" | tr '[:upper:]' '[:lower:]')"

  # Collapse runs of hyphens/underscores, split and rejoin with single hyphens
  local slug=""
  slug="$(echo "$mapped" | sed \
    -e 's/[-_][-_]*/-/g' \
    -e 's/^[-_]*//' \
    -e 's/[-_]*$//')"

  [[ -z "$slug" ]] && slug="workspace"
  echo "$slug"
}

# branchToDir: sanitise a branch name for use as a directory name.
# Mirrors electron/services/workspace/git.ts:branchToDir exactly.
branch_to_dir() {
  echo "$1" | sed 's/[/\\:*?"<>| ]/_/g'
}

# Resolve a branch argument to a worktree path.
# Tries: exact branch match in git worktree list, then display_name lookup in metadata.
resolve_worktree_path() {
  local branch="$1"
  local dir_name
  dir_name="$(branch_to_dir "$branch")"
  local candidate="$WORKTREES_ROOT/$dir_name"

  # Direct path match
  if [[ -d "$candidate" && -e "$candidate/.git" ]]; then
    echo "$candidate"
    return 0
  fi

  # Try as a slug (user may have passed the original title)
  local slug
  slug="$(title_to_branch_slug "$branch")"
  local slug_dir
  slug_dir="$(branch_to_dir "$slug")"
  candidate="$WORKTREES_ROOT/$slug_dir"
  if [[ -d "$candidate" && -e "$candidate/.git" ]]; then
    echo "$candidate"
    return 0
  fi

  # Search git worktree list for matching branch
  local wt_path=""
  while IFS= read -r line; do
    if [[ "$line" == "worktree "* ]]; then
      wt_path="${line#worktree }"
    elif [[ "$line" == "branch "* ]]; then
      local wt_branch="${line#branch }"
      wt_branch="${wt_branch#refs/heads/}"
      if [[ "$wt_branch" == "$branch" || "$wt_branch" == "$slug" ]]; then
        if [[ "$wt_path" == "$WORKTREES_ROOT"* ]]; then
          echo "$wt_path"
          return 0
        fi
      fi
    elif [[ -z "$line" ]]; then
      wt_path=""
    fi
  done < <(git -C "$REPO_ROOT" worktree list --porcelain 2>/dev/null)

  # Fallback: search metadata display_name
  if [[ -f "$METADATA_FILE" ]]; then
    local match
    match="$(jq -r --arg name "$branch" '
      .workspaces | to_entries[]
      | select(.value.display_name == $name)
      | .key' "$METADATA_FILE" 2>/dev/null | head -1)"
    if [[ -n "$match" && -d "$match" ]]; then
      echo "$match"
      return 0
    fi
  fi

  echo "error: worktree not found for '$branch'" >&2
  return 1
}

# Get the branch name for a worktree path.
get_worktree_branch() {
  local wt_path="$1"
  git -C "$wt_path" rev-parse --abbrev-ref HEAD 2>/dev/null
}

# ---------------------------------------------------------------------------
# Metadata helpers (must match electron/services/workspace/metadata.ts)
# ---------------------------------------------------------------------------

# Ensure the metadata file exists with valid schema.
ensure_metadata() {
  mkdir -p "$WORKTREES_ROOT"
  if [[ ! -f "$METADATA_FILE" ]]; then
    echo '{"version":1,"workspaces":{}}' > "$METADATA_FILE"
  fi
}

# Read a metadata field for a worktree path.
read_meta() {
  local wt_path="$1"
  local field="$2"
  if [[ -f "$METADATA_FILE" ]]; then
    jq -r --arg p "$wt_path" ".workspaces[\$p].$field // empty" "$METADATA_FILE" 2>/dev/null
  fi
}

# Write/update metadata for a worktree path (atomic write via temp file + mv).
write_meta() {
  local wt_path="$1"
  local id="$2"
  local display_name="$3"
  local description="$4"
  local base_branch="$5"

  ensure_metadata

  local tmp
  tmp="$(mktemp "${METADATA_FILE}.XXXXXX")"

  jq --arg p "$wt_path" \
     --arg id "$id" \
     --arg dn "$display_name" \
     --arg desc "$description" \
     --arg bb "$base_branch" \
     '.workspaces[$p] = {id: $id, display_name: $dn, description: $desc, base_branch: $bb}' \
     "$METADATA_FILE" > "$tmp" && mv "$tmp" "$METADATA_FILE"
}

# Remove metadata for a worktree path.
remove_meta() {
  local wt_path="$1"
  if [[ -f "$METADATA_FILE" ]]; then
    local tmp
    tmp="$(mktemp "${METADATA_FILE}.XXXXXX")"
    jq --arg p "$wt_path" 'del(.workspaces[$p])' "$METADATA_FILE" > "$tmp" && mv "$tmp" "$METADATA_FILE"
  fi
}

# Generate a UUID (macOS uuidgen or fallback).
gen_uuid() {
  if command -v uuidgen &>/dev/null; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "$(date +%s)-$$-$RANDOM"
  fi
}

# ---------------------------------------------------------------------------
# Setup pipeline (must match electron/services/workspace/setup.ts)
# ---------------------------------------------------------------------------

# Load .stagehand.json (+ .stagehand.local.json overlay) and run setup.
run_setup_pipeline() {
  local wt_path="$1"
  local config_file="$REPO_ROOT/.stagehand.json"
  local local_file="$REPO_ROOT/.stagehand.local.json"

  # Load base config
  local copy_patterns=()
  local symlink_patterns=()
  local commands=()

  if [[ -f "$config_file" ]]; then
    while IFS= read -r p; do
      [[ -n "$p" ]] && copy_patterns+=("$p")
    done < <(jq -r '.setup.copy[]? // empty' "$config_file" 2>/dev/null)

    while IFS= read -r p; do
      [[ -n "$p" ]] && symlink_patterns+=("$p")
    done < <(jq -r '.setup.symlink[]? // empty' "$config_file" 2>/dev/null)

    while IFS= read -r p; do
      [[ -n "$p" ]] && commands+=("$p")
    done < <(jq -r '.setup.commands[]? // empty' "$config_file" 2>/dev/null)
  fi

  # Overlay local config (append, deduplicate)
  if [[ -f "$local_file" ]]; then
    while IFS= read -r p; do
      if [[ -n "$p" ]] && ! printf '%s\n' "${copy_patterns[@]}" | grep -qxF "$p" 2>/dev/null; then
        copy_patterns+=("$p")
      fi
    done < <(jq -r '.setup.copy[]? // empty' "$local_file" 2>/dev/null)

    while IFS= read -r p; do
      if [[ -n "$p" ]] && ! printf '%s\n' "${symlink_patterns[@]}" | grep -qxF "$p" 2>/dev/null; then
        symlink_patterns+=("$p")
      fi
    done < <(jq -r '.setup.symlink[]? // empty' "$local_file" 2>/dev/null)

    while IFS= read -r p; do
      if [[ -n "$p" ]] && ! printf '%s\n' "${commands[@]}" | grep -qxF "$p" 2>/dev/null; then
        commands+=("$p")
      fi
    done < <(jq -r '.setup.commands[]? // empty' "$local_file" 2>/dev/null)
  fi

  # Copy phase
  for pattern in "${copy_patterns[@]}"; do
    # For non-glob patterns, copy directly
    if [[ "$pattern" != *"*"* && "$pattern" != *"?"* && "$pattern" != *"["* ]]; then
      local src="$REPO_ROOT/$pattern"
      local dst="$wt_path/$pattern"
      if [[ -e "$src" ]]; then
        echo "[stagehand] Copying $pattern..."
        mkdir -p "$(dirname "$dst")"
        if [[ -d "$src" ]]; then
          cp -R "$src" "$dst"
        else
          cp "$src" "$dst"
        fi
      else
        echo "[stagehand] Warning: $pattern not found, skipping."
      fi
    else
      # Glob pattern: expand relative to repo root
      local matches=()
      while IFS= read -r match; do
        [[ -n "$match" ]] && matches+=("$match")
      done < <(cd "$REPO_ROOT" && find . -path "./$pattern" -not -path '*/.git/*' 2>/dev/null | sed 's|^\./||')

      if [[ ${#matches[@]} -eq 0 ]]; then
        echo "[stagehand] Warning: $pattern matched nothing, skipping."
      else
        for match in "${matches[@]}"; do
          local src="$REPO_ROOT/$match"
          local dst="$wt_path/$match"
          echo "[stagehand] Copying $match..."
          mkdir -p "$(dirname "$dst")"
          if [[ -d "$src" ]]; then
            cp -R "$src" "$dst"
          else
            cp "$src" "$dst"
          fi
        done
      fi
    fi
  done

  # Symlink phase
  for pattern in "${symlink_patterns[@]}"; do
    if [[ "$pattern" != *"*"* && "$pattern" != *"?"* && "$pattern" != *"["* ]]; then
      local src="$REPO_ROOT/$pattern"
      local dst="$wt_path/$pattern"
      if [[ -e "$src" ]]; then
        echo "[stagehand] Symlinking $pattern..."
        mkdir -p "$(dirname "$dst")"
        [[ -e "$dst" || -L "$dst" ]] && rm -rf "$dst"
        ln -s "$src" "$dst"
      else
        echo "[stagehand] Warning: $pattern not found, skipping."
      fi
    else
      while IFS= read -r match; do
        if [[ -n "$match" ]]; then
          local src="$REPO_ROOT/$match"
          local dst="$wt_path/$match"
          echo "[stagehand] Symlinking $match..."
          mkdir -p "$(dirname "$dst")"
          [[ -e "$dst" || -L "$dst" ]] && rm -rf "$dst"
          ln -s "$src" "$dst"
        fi
      done < <(cd "$REPO_ROOT" && find . -path "./$pattern" -not -path '*/.git/*' 2>/dev/null | sed 's|^\./||')
    fi
  done

  # Commands phase
  for cmd in "${commands[@]}"; do
    echo "[stagehand] Running: $cmd"
    if ! (cd "$wt_path" && sh -c "$cmd"); then
      echo "error: setup command failed: $cmd" >&2
      return 1
    fi
  done

  echo "[stagehand] Setup complete."
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

cmd_create() {
  local name=""
  local description=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --description) description="$2"; shift 2 ;;
      --description=*) description="${1#--description=}"; shift ;;
      -*) echo "error: unknown flag: $1" >&2; exit 1 ;;
      *)
        if [[ -z "$name" ]]; then
          name="$1"; shift
        else
          echo "error: unexpected argument: $1" >&2; exit 1
        fi
        ;;
    esac
  done

  if [[ -z "$name" ]]; then
    echo "usage: stagehand create <name> [--description \"...\"]" >&2
    exit 1
  fi

  local branch_slug
  branch_slug="$(title_to_branch_slug "$name")"
  local dir_name
  dir_name="$(branch_to_dir "$branch_slug")"
  local wt_path="$WORKTREES_ROOT/$dir_name"

  if [[ -d "$wt_path" ]]; then
    echo "error: worktree already exists at $wt_path" >&2
    exit 1
  fi

  # Capture current branch as base
  local base_branch
  base_branch="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null)" || base_branch=""

  mkdir -p "$WORKTREES_ROOT"

  echo "Creating worktree '$branch_slug' at $wt_path..."
  git -C "$REPO_ROOT" worktree add -b "$branch_slug" "$wt_path" HEAD

  # Write metadata
  local id
  id="$(gen_uuid)"
  write_meta "$wt_path" "$id" "$name" "$description" "$base_branch"

  # Run setup pipeline
  run_setup_pipeline "$wt_path"

  echo ""
  echo "Worktree created:"
  echo "  Branch: $branch_slug"
  echo "  Path:   $wt_path"
  echo "  Base:   ${base_branch:-HEAD}"
}

cmd_list() {
  ensure_metadata

  # Parse git worktree list --porcelain, filter to managed worktrees
  local wt_path="" wt_branch=""
  local found=false

  printf "%-30s %-40s %s\n" "BRANCH" "PATH" "BASE"
  printf "%-30s %-40s %s\n" "------" "----" "----"

  while IFS= read -r line; do
    if [[ "$line" == "worktree "* ]]; then
      wt_path="${line#worktree }"
    elif [[ "$line" == "branch "* ]]; then
      wt_branch="${line#branch }"
      wt_branch="${wt_branch#refs/heads/}"
    elif [[ -z "$line" ]]; then
      if [[ -n "$wt_path" && "$wt_path" == "$WORKTREES_ROOT"* ]]; then
        local base=""
        base="$(read_meta "$wt_path" "base_branch")" || true
        printf "%-30s %-40s %s\n" "$wt_branch" "$wt_path" "${base:--}"
        found=true
      fi
      wt_path=""
      wt_branch=""
    fi
  done < <(git -C "$REPO_ROOT" worktree list --porcelain 2>/dev/null; echo "")

  if [[ "$found" == false ]]; then
    echo "(no worktrees)"
  fi
}

cmd_path() {
  if [[ $# -lt 1 ]]; then
    echo "usage: stagehand path <branch>" >&2
    exit 1
  fi
  resolve_worktree_path "$1"
}

cmd_status() {
  if [[ $# -lt 1 ]]; then
    echo "usage: stagehand status <branch>" >&2
    exit 1
  fi
  local wt_path
  wt_path="$(resolve_worktree_path "$1")"
  git -C "$wt_path" status --short
}

cmd_diff() {
  if [[ $# -lt 1 ]]; then
    echo "usage: stagehand diff <branch>" >&2
    exit 1
  fi
  local wt_path
  wt_path="$(resolve_worktree_path "$1")"
  git -C "$wt_path" diff
}

cmd_log() {
  local branch="" count="20"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -n) count="$2"; shift 2 ;;
      -*) echo "error: unknown flag: $1" >&2; exit 1 ;;
      *) branch="$1"; shift ;;
    esac
  done
  if [[ -z "$branch" ]]; then
    echo "usage: stagehand log <branch> [-n <count>]" >&2
    exit 1
  fi
  local wt_path
  wt_path="$(resolve_worktree_path "$branch")"
  git -C "$wt_path" log --oneline -n "$count"
}

cmd_commit() {
  local branch="" message=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -m) message="$2"; shift 2 ;;
      -*) echo "error: unknown flag: $1" >&2; exit 1 ;;
      *) branch="$1"; shift ;;
    esac
  done
  if [[ -z "$branch" || -z "$message" ]]; then
    echo "usage: stagehand commit <branch> -m \"message\"" >&2
    exit 1
  fi
  local wt_path
  wt_path="$(resolve_worktree_path "$branch")"

  # Stage all changes
  git -C "$wt_path" add -A

  # Check if there's anything to commit
  if git -C "$wt_path" diff --cached --quiet 2>/dev/null; then
    echo "Nothing to commit in $branch."
    return 0
  fi

  git -C "$wt_path" commit -m "$message"
}

cmd_merge() {
  local branch="" into=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --into) into="$2"; shift 2 ;;
      --into=*) into="${1#--into=}"; shift ;;
      -*) echo "error: unknown flag: $1" >&2; exit 1 ;;
      *) branch="$1"; shift ;;
    esac
  done
  if [[ -z "$branch" ]]; then
    echo "usage: stagehand merge <branch> [--into <base>]" >&2
    exit 1
  fi

  local wt_path
  wt_path="$(resolve_worktree_path "$branch")"
  local wt_branch
  wt_branch="$(get_worktree_branch "$wt_path")"

  # Determine base branch
  if [[ -z "$into" ]]; then
    into="$(read_meta "$wt_path" "base_branch")" || true
    if [[ -z "$into" ]]; then
      into="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null)"
    fi
  fi

  echo "Merging '$wt_branch' into '$into'..."

  # Commit any staged changes in the workspace first
  if ! git -C "$wt_path" diff --cached --quiet 2>/dev/null; then
    echo "Committing staged changes in worktree..."
    git -C "$wt_path" commit -m "Workspace changes"
  fi

  # Check for conflicts first
  local conflicts
  conflicts="$(check_conflicts_internal "$wt_branch" "$into")" || true
  if [[ -n "$conflicts" ]]; then
    echo "error: cannot merge — conflicting files:" >&2
    echo "$conflicts" >&2
    exit 1
  fi

  # If the base branch is already checked out at the repo root, merge directly
  # there. Otherwise create a temp worktree for the base branch.
  local current_branch
  current_branch="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null)" || current_branch=""

  if [[ "$current_branch" == "$into" ]]; then
    git -C "$REPO_ROOT" merge --no-ff "$wt_branch" -m "Merge $wt_branch into $into"
  else
    local temp_name="_merge-staging-$(gen_uuid)"
    local temp_path="$WORKTREES_ROOT/$temp_name"

    _merge_temp_path="$temp_path"
    trap 'cleanup_temp_worktree "$_merge_temp_path"' EXIT

    git -C "$REPO_ROOT" worktree add "$temp_path" "$into"
    git -C "$temp_path" merge --no-ff "$wt_branch" -m "Merge $wt_branch into $into"

    cleanup_temp_worktree "$temp_path"
    trap - EXIT
    _merge_temp_path=""
  fi

  echo "Successfully merged '$wt_branch' into '$into'."
}

# Global variable for trap cleanup (needs to be accessible from trap handler).
_merge_temp_path=""

cleanup_temp_worktree() {
  local temp_path="$1"
  if [[ -d "$temp_path" ]]; then
    git -C "$REPO_ROOT" worktree remove --force "$temp_path" 2>/dev/null || rm -rf "$temp_path"
    git -C "$REPO_ROOT" worktree prune 2>/dev/null || true
  fi
}

cmd_conflicts() {
  local branch="" with_branch=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --with) with_branch="$2"; shift 2 ;;
      --with=*) with_branch="${1#--with=}"; shift ;;
      -*) echo "error: unknown flag: $1" >&2; exit 1 ;;
      *) branch="$1"; shift ;;
    esac
  done
  if [[ -z "$branch" ]]; then
    echo "usage: stagehand conflicts <branch> [--with <base>]" >&2
    exit 1
  fi

  local wt_path
  wt_path="$(resolve_worktree_path "$branch")"
  local wt_branch
  wt_branch="$(get_worktree_branch "$wt_path")"

  if [[ -z "$with_branch" ]]; then
    with_branch="$(read_meta "$wt_path" "base_branch")" || true
    if [[ -z "$with_branch" ]]; then
      with_branch="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null)"
    fi
  fi

  local conflicts
  conflicts="$(check_conflicts_internal "$wt_branch" "$with_branch")" || true

  if [[ -z "$conflicts" ]]; then
    echo "No conflicts between '$wt_branch' and '$with_branch'."
  else
    echo "Conflicting files between '$wt_branch' and '$with_branch':"
    echo "$conflicts"
    exit 1
  fi
}

# Internal conflict check — mirrors merge.ts logic.
check_conflicts_internal() {
  local workspace_branch="$1"
  local base_branch="$2"

  # git merge-tree --write-tree exits 0 for clean merge, 1 for conflicts
  local output=""
  local exit_code=0
  output="$(git -C "$REPO_ROOT" merge-tree --write-tree --no-messages "$workspace_branch" "$base_branch" 2>&1)" || exit_code=$?

  if [[ $exit_code -eq 0 ]]; then
    # Clean merge
    return 0
  fi

  # Parse CONFLICT lines
  local conflicts=""
  while IFS= read -r line; do
    if [[ "$line" == CONFLICT* ]]; then
      # Extract file path from "CONFLICT (...): Merge conflict in <path>"
      local file_path=""
      if [[ "$line" == *"Merge conflict in "* ]]; then
        file_path="${line##*Merge conflict in }"
        file_path="${file_path##*merge conflict in }"
        file_path="$(echo "$file_path" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      elif [[ "$line" == *"merge conflict in "* ]]; then
        file_path="${line##*merge conflict in }"
        file_path="$(echo "$file_path" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      fi
      if [[ -n "$file_path" ]]; then
        conflicts="${conflicts}${file_path}\n"
      fi
    fi
  done <<< "$output"

  if [[ -n "$conflicts" ]]; then
    printf "%b" "$conflicts" | sed '/^$/d'
  else
    # Conflicts exist but couldn't parse specific files — fallback to legacy
    local merge_base
    merge_base="$(git -C "$REPO_ROOT" merge-base "$base_branch" "$workspace_branch" 2>/dev/null)" || true
    if [[ -n "$merge_base" ]]; then
      local legacy=""
      legacy="$(git -C "$REPO_ROOT" merge-tree "$merge_base" "$base_branch" "$workspace_branch" 2>/dev/null)" || true
      echo "$legacy" | grep -E '^\+<<<<<<<|changed in both' | sed 's/^changed in both//' | sed 's/^:*//' | sed 's/^[[:space:]]*//' | grep -v '^$' || echo "(unable to determine specific conflicting files)"
    else
      echo "(unable to determine specific conflicting files)"
    fi
  fi
}

cmd_delete() {
  local branch="" keep_branch=false
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --keep-branch) keep_branch=true; shift ;;
      -*) echo "error: unknown flag: $1" >&2; exit 1 ;;
      *) branch="$1"; shift ;;
    esac
  done
  if [[ -z "$branch" ]]; then
    echo "usage: stagehand delete <branch> [--keep-branch]" >&2
    exit 1
  fi

  local wt_path
  wt_path="$(resolve_worktree_path "$branch")"
  local wt_branch
  wt_branch="$(get_worktree_branch "$wt_path")"

  echo "Removing worktree '$wt_branch' at $wt_path..."

  git -C "$REPO_ROOT" worktree remove --force "$wt_path" 2>/dev/null || {
    echo "Warning: git worktree remove failed, force-removing directory..." >&2
    rm -rf "$wt_path"
  }
  git -C "$REPO_ROOT" worktree prune 2>/dev/null || true

  if [[ "$keep_branch" == false ]]; then
    echo "Deleting branch '$wt_branch'..."
    git -C "$REPO_ROOT" branch -D "$wt_branch" 2>/dev/null || {
      echo "Warning: could not delete branch '$wt_branch'" >&2
    }
  fi

  remove_meta "$wt_path"

  echo "Worktree deleted."
}

cmd_exec() {
  if [[ $# -lt 1 ]]; then
    echo "usage: stagehand exec <branch> [--] <command...>" >&2
    exit 1
  fi

  local branch="$1"; shift

  # Skip optional --
  [[ "${1:-}" == "--" ]] && shift

  if [[ $# -eq 0 ]]; then
    echo "usage: stagehand exec <branch> [--] <command...>" >&2
    exit 1
  fi

  local wt_path
  wt_path="$(resolve_worktree_path "$branch")"

  (cd "$wt_path" && "$@")
}

cmd_help() {
  cat <<'HELP'
stagehand — CLI for managing Stagehand worktrees

Usage: stagehand [--repo <path>] <command> [args...]

Commands:
  create   <name> [--description "..."]   Create a new worktree + branch
  list                                     List all Stagehand worktrees
  path     <branch>                        Print worktree path
  status   <branch>                        git status in worktree
  diff     <branch>                        git diff in worktree
  log      <branch> [-n <count>]           git log in worktree
  commit   <branch> -m "message"           Stage all + commit in worktree
  merge    <branch> [--into <base>]        Merge branch into base
  conflicts <branch> [--with <base>]       Check for merge conflicts
  delete   <branch> [--keep-branch]        Remove worktree (+ branch)
  exec     <branch> [--] <command...>      Run command in worktree dir

Global flags:
  --repo <path>   Target a specific repo (default: auto-detect from CWD)
HELP
}

# ---------------------------------------------------------------------------
# Main dispatch
# ---------------------------------------------------------------------------

if [[ $# -eq 0 ]]; then
  cmd_help
  exit 0
fi

COMMAND="$1"; shift

case "$COMMAND" in
  create)    cmd_create "$@" ;;
  list|ls)   cmd_list "$@" ;;
  path)      cmd_path "$@" ;;
  status|st) cmd_status "$@" ;;
  diff)      cmd_diff "$@" ;;
  log)       cmd_log "$@" ;;
  commit|ci) cmd_commit "$@" ;;
  merge)     cmd_merge "$@" ;;
  conflicts) cmd_conflicts "$@" ;;
  delete|rm) cmd_delete "$@" ;;
  exec)      cmd_exec "$@" ;;
  help|--help|-h) cmd_help ;;
  *)
    echo "error: unknown command '$COMMAND'. Run 'stagehand help' for usage." >&2
    exit 1
    ;;
esac
