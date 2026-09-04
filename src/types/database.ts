export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      action_plan_founder_attestations: {
        Row: {
          action_plan_id: string
          action_plan_step_key: string
          action_plan_step_order: number
          attestation_version: string
          attested_by_user_id: string
          created_at: string
          id: string
          project_id: string
        }
        Insert: {
          action_plan_id: string
          action_plan_step_key: string
          action_plan_step_order: number
          attestation_version?: string
          attested_by_user_id: string
          created_at?: string
          id?: string
          project_id: string
        }
        Update: {
          action_plan_id?: string
          action_plan_step_key?: string
          action_plan_step_order?: number
          attestation_version?: string
          attested_by_user_id?: string
          created_at?: string
          id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_plan_founder_attestations_plan_project_fk"
            columns: ["action_plan_id", "project_id"]
            isOneToOne: false
            referencedRelation: "action_plans"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "action_plan_founder_attestations_plan_step_fk"
            columns: ["action_plan_id", "action_plan_step_key"]
            isOneToOne: true
            referencedRelation: "action_plan_steps"
            referencedColumns: ["action_plan_id", "step_key"]
          },
          {
            foreignKeyName: "action_plan_founder_attestations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      action_plan_steps: {
        Row: {
          action_plan_id: string
          actor: string
          capability: string | null
          change_kind: string
          completion_criteria: string
          created_at: string
          depends_on: Json
          description: string
          evidence_ids: Json
          execution_support: string
          founder_input_requirement: Json | null
          id: string
          purpose: string
          requires_approval: boolean
          step_key: string
          step_order: number
          title: string
        }
        Insert: {
          action_plan_id: string
          actor: string
          capability?: string | null
          change_kind: string
          completion_criteria: string
          created_at?: string
          depends_on?: Json
          description: string
          evidence_ids?: Json
          execution_support: string
          founder_input_requirement?: Json | null
          id?: string
          purpose: string
          requires_approval?: boolean
          step_key: string
          step_order: number
          title: string
        }
        Update: {
          action_plan_id?: string
          actor?: string
          capability?: string | null
          change_kind?: string
          completion_criteria?: string
          created_at?: string
          depends_on?: Json
          description?: string
          evidence_ids?: Json
          execution_support?: string
          founder_input_requirement?: Json | null
          id?: string
          purpose?: string
          requires_approval?: boolean
          step_key?: string
          step_order?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_plan_steps_action_plan_id_fkey"
            columns: ["action_plan_id"]
            isOneToOne: false
            referencedRelation: "action_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      action_plans: {
        Row: {
          addresses_root_problem: string | null
          assumptions: Json
          business_audit_id: string
          completed_at: string | null
          contract_version: string
          created_at: string
          evidence_pack_version: string
          expected_outcome: string | null
          failure_code: string | null
          founder_intent_hash: string
          goal: string | null
          id: string
          input_hash: string
          lenses: Json
          model: string
          opportunity_id: string
          opportunity_set_id: string
          planner_version: string
          product_profile_id: string
          project_id: string
          prompt_version: string
          provider: string
          root_problem: string | null
          rubric_version: string
          schema_version: string
          source_conclusion_key: string | null
          source_conclusion_lineage: string | null
          started_at: string | null
          status: string
          step_count: number | null
          updated_at: string
          validation_findings: Json
          validation_notes: Json
          why_now: string | null
        }
        Insert: {
          addresses_root_problem?: string | null
          assumptions?: Json
          business_audit_id: string
          completed_at?: string | null
          contract_version: string
          created_at?: string
          evidence_pack_version: string
          expected_outcome?: string | null
          failure_code?: string | null
          founder_intent_hash: string
          goal?: string | null
          id?: string
          input_hash: string
          lenses?: Json
          model: string
          opportunity_id: string
          opportunity_set_id: string
          planner_version: string
          product_profile_id: string
          project_id: string
          prompt_version: string
          provider: string
          root_problem?: string | null
          rubric_version: string
          schema_version: string
          source_conclusion_key?: string | null
          source_conclusion_lineage?: string | null
          started_at?: string | null
          status?: string
          step_count?: number | null
          updated_at?: string
          validation_findings?: Json
          validation_notes?: Json
          why_now?: string | null
        }
        Update: {
          addresses_root_problem?: string | null
          assumptions?: Json
          business_audit_id?: string
          completed_at?: string | null
          contract_version?: string
          created_at?: string
          evidence_pack_version?: string
          expected_outcome?: string | null
          failure_code?: string | null
          founder_intent_hash?: string
          goal?: string | null
          id?: string
          input_hash?: string
          lenses?: Json
          model?: string
          opportunity_id?: string
          opportunity_set_id?: string
          planner_version?: string
          product_profile_id?: string
          project_id?: string
          prompt_version?: string
          provider?: string
          root_problem?: string | null
          rubric_version?: string
          schema_version?: string
          source_conclusion_key?: string | null
          source_conclusion_lineage?: string | null
          started_at?: string | null
          status?: string
          step_count?: number | null
          updated_at?: string
          validation_findings?: Json
          validation_notes?: Json
          why_now?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "action_plans_business_audit_id_fkey"
            columns: ["business_audit_id"]
            isOneToOne: false
            referencedRelation: "business_readiness_audits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_plans_opportunity_set_id_fkey"
            columns: ["opportunity_set_id"]
            isOneToOne: false
            referencedRelation: "opportunity_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_plans_product_profile_id_fkey"
            columns: ["product_profile_id"]
            isOneToOne: false
            referencedRelation: "product_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_activity_events: {
        Row: {
          agent_execution_run_id: string
          changed_paths: Json | null
          command: string | null
          created_at: string
          event: string
          files_read: number | null
          id: string
          occurred_at: string
          project_id: string
          sequence: number
        }
        Insert: {
          agent_execution_run_id: string
          changed_paths?: Json | null
          command?: string | null
          created_at?: string
          event: string
          files_read?: number | null
          id?: string
          occurred_at: string
          project_id: string
          sequence: number
        }
        Update: {
          agent_execution_run_id?: string
          changed_paths?: Json | null
          command?: string | null
          created_at?: string
          event?: string
          files_read?: number | null
          id?: string
          occurred_at?: string
          project_id?: string
          sequence?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_activity_events_agent_execution_run_id_fkey"
            columns: ["agent_execution_run_id"]
            isOneToOne: false
            referencedRelation: "agent_execution_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_activity_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_execution_events: {
        Row: {
          agent_execution_run_id: string
          audience: string
          created_at: string
          id: string
          metadata: Json
          occurred_at: string
          phase: string
          project_id: string
          sequence: number
          summary: string
          type: string
          user_id: string
        }
        Insert: {
          agent_execution_run_id: string
          audience: string
          created_at?: string
          id?: string
          metadata?: Json
          occurred_at: string
          phase: string
          project_id: string
          sequence: number
          summary: string
          type: string
          user_id: string
        }
        Update: {
          agent_execution_run_id?: string
          audience?: string
          created_at?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          phase?: string
          project_id?: string
          sequence?: number
          summary?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_execution_events_agent_execution_run_id_fkey"
            columns: ["agent_execution_run_id"]
            isOneToOne: false
            referencedRelation: "agent_execution_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_execution_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_execution_runs: {
        Row: {
          assistant_messages: number
          base_sha: string
          budget_policy_version: string
          changed_bytes: number
          changed_file_count: number
          check_runs: number
          coding_agent_policy_version: string
          completed_at: string | null
          completion_budget_version: string | null
          completion_refusals: number | null
          completion_windows: number | null
          context_brief_version: string | null
          context_bytes: number | null
          context_candidates_available: number | null
          context_candidates_read: number | null
          context_candidates_sent: number | null
          context_facts_sent: number | null
          context_freshness: string | null
          context_surface_pages: number | null
          context_surface_scopes: string[] | null
          convergence_mutations: number | null
          created_at: string
          credit_reservation_id: string | null
          dogfood_fixture_id: string | null
          duration_ms: number | null
          execution_origin: string
          execution_policy_version: string
          execution_spec_id: string
          failure_code: string | null
          files_read: number
          files_read_outside_context: number | null
          gateway_requests_started: number
          harness: string
          id: string
          implementation_mutations: number | null
          model: string
          non_production_economics: boolean
          observed_path_count: number
          operation_run_id: string
          policy_decisions: number | null
          post_edit_commands: number | null
          post_edit_provider_calls: number | null
          post_edit_provider_cost_usd: number | null
          post_edit_reads: number | null
          post_edit_reads_beyond_brief: number | null
          post_edit_tool_calls: number | null
          prepared_change_id: string | null
          project_id: string
          prompt_compiler_version: string
          provider: string
          provider_session_id: string | null
          repair_attempts: number
          repair_cycles: number | null
          repeated_file_reads: number | null
          repo_bytes_analyzed: number | null
          repo_files_analyzed: number | null
          repo_routes_detected: number | null
          repo_surfaces_detected: number | null
          repo_tree_entries: number | null
          required_verification_actions: number | null
          required_verification_overrides: number | null
          run_identity: string
          sdk_loop_iterations: number | null
          started_at: string | null
          status: string
          time_to_first_edit_ms: number | null
          time_to_last_edit_ms: number | null
          tool_calls_allowed: number
          tool_calls_denied: number
          unique_files_read: number | null
          updated_at: string
          user_id: string
          verification_commands: number | null
          verification_mode: string | null
          verification_ms: number | null
          verification_plan_version: string | null
          verification_refusals: number | null
        }
        Insert: {
          assistant_messages?: number
          base_sha: string
          budget_policy_version: string
          changed_bytes?: number
          changed_file_count?: number
          check_runs?: number
          coding_agent_policy_version: string
          completed_at?: string | null
          completion_budget_version?: string | null
          completion_refusals?: number | null
          completion_windows?: number | null
          context_brief_version?: string | null
          context_bytes?: number | null
          context_candidates_available?: number | null
          context_candidates_read?: number | null
          context_candidates_sent?: number | null
          context_facts_sent?: number | null
          context_freshness?: string | null
          context_surface_pages?: number | null
          context_surface_scopes?: string[] | null
          convergence_mutations?: number | null
          created_at?: string
          credit_reservation_id?: string | null
          dogfood_fixture_id?: string | null
          duration_ms?: number | null
          execution_origin?: string
          execution_policy_version: string
          execution_spec_id: string
          failure_code?: string | null
          files_read?: number
          files_read_outside_context?: number | null
          gateway_requests_started?: number
          harness: string
          id?: string
          implementation_mutations?: number | null
          model: string
          non_production_economics?: boolean
          observed_path_count?: number
          operation_run_id: string
          policy_decisions?: number | null
          post_edit_commands?: number | null
          post_edit_provider_calls?: number | null
          post_edit_provider_cost_usd?: number | null
          post_edit_reads?: number | null
          post_edit_reads_beyond_brief?: number | null
          post_edit_tool_calls?: number | null
          prepared_change_id?: string | null
          project_id: string
          prompt_compiler_version: string
          provider: string
          provider_session_id?: string | null
          repair_attempts?: number
          repair_cycles?: number | null
          repeated_file_reads?: number | null
          repo_bytes_analyzed?: number | null
          repo_files_analyzed?: number | null
          repo_routes_detected?: number | null
          repo_surfaces_detected?: number | null
          repo_tree_entries?: number | null
          required_verification_actions?: number | null
          required_verification_overrides?: number | null
          run_identity: string
          sdk_loop_iterations?: number | null
          started_at?: string | null
          status?: string
          time_to_first_edit_ms?: number | null
          time_to_last_edit_ms?: number | null
          tool_calls_allowed?: number
          tool_calls_denied?: number
          unique_files_read?: number | null
          updated_at?: string
          user_id: string
          verification_commands?: number | null
          verification_mode?: string | null
          verification_ms?: number | null
          verification_plan_version?: string | null
          verification_refusals?: number | null
        }
        Update: {
          assistant_messages?: number
          base_sha?: string
          budget_policy_version?: string
          changed_bytes?: number
          changed_file_count?: number
          check_runs?: number
          coding_agent_policy_version?: string
          completed_at?: string | null
          completion_budget_version?: string | null
          completion_refusals?: number | null
          completion_windows?: number | null
          context_brief_version?: string | null
          context_bytes?: number | null
          context_candidates_available?: number | null
          context_candidates_read?: number | null
          context_candidates_sent?: number | null
          context_facts_sent?: number | null
          context_freshness?: string | null
          context_surface_pages?: number | null
          context_surface_scopes?: string[] | null
          convergence_mutations?: number | null
          created_at?: string
          credit_reservation_id?: string | null
          dogfood_fixture_id?: string | null
          duration_ms?: number | null
          execution_origin?: string
          execution_policy_version?: string
          execution_spec_id?: string
          failure_code?: string | null
          files_read?: number
          files_read_outside_context?: number | null
          gateway_requests_started?: number
          harness?: string
          id?: string
          implementation_mutations?: number | null
          model?: string
          non_production_economics?: boolean
          observed_path_count?: number
          operation_run_id?: string
          policy_decisions?: number | null
          post_edit_commands?: number | null
          post_edit_provider_calls?: number | null
          post_edit_provider_cost_usd?: number | null
          post_edit_reads?: number | null
          post_edit_reads_beyond_brief?: number | null
          post_edit_tool_calls?: number | null
          prepared_change_id?: string | null
          project_id?: string
          prompt_compiler_version?: string
          provider?: string
          provider_session_id?: string | null
          repair_attempts?: number
          repair_cycles?: number | null
          repeated_file_reads?: number | null
          repo_bytes_analyzed?: number | null
          repo_files_analyzed?: number | null
          repo_routes_detected?: number | null
          repo_surfaces_detected?: number | null
          repo_tree_entries?: number | null
          required_verification_actions?: number | null
          required_verification_overrides?: number | null
          run_identity?: string
          sdk_loop_iterations?: number | null
          started_at?: string | null
          status?: string
          time_to_first_edit_ms?: number | null
          time_to_last_edit_ms?: number | null
          tool_calls_allowed?: number
          tool_calls_denied?: number
          unique_files_read?: number | null
          updated_at?: string
          user_id?: string
          verification_commands?: number | null
          verification_mode?: string | null
          verification_ms?: number | null
          verification_plan_version?: string | null
          verification_refusals?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_execution_runs_execution_spec_id_fkey"
            columns: ["execution_spec_id"]
            isOneToOne: false
            referencedRelation: "execution_specs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_execution_runs_operation_run_id_fkey"
            columns: ["operation_run_id"]
            isOneToOne: false
            referencedRelation: "operation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_execution_runs_prepared_change_id_fkey"
            columns: ["prepared_change_id"]
            isOneToOne: false
            referencedRelation: "prepared_changes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_execution_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_tool_events: {
        Row: {
          agent_execution_run_id: string
          bytes: number | null
          capability: string | null
          command: string | null
          created_at: string
          decision: string
          denial_reason: string | null
          duration_ms: number
          exit_code: number | null
          id: string
          path: string | null
          project_id: string
          sequence: number
          started_at: string
          success: boolean | null
          tool: string
        }
        Insert: {
          agent_execution_run_id: string
          bytes?: number | null
          capability?: string | null
          command?: string | null
          created_at?: string
          decision: string
          denial_reason?: string | null
          duration_ms: number
          exit_code?: number | null
          id?: string
          path?: string | null
          project_id: string
          sequence: number
          started_at: string
          success?: boolean | null
          tool: string
        }
        Update: {
          agent_execution_run_id?: string
          bytes?: number | null
          capability?: string | null
          command?: string | null
          created_at?: string
          decision?: string
          denial_reason?: string | null
          duration_ms?: number
          exit_code?: number | null
          id?: string
          path?: string | null
          project_id?: string
          sequence?: number
          started_at?: string
          success?: boolean | null
          tool?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_tool_events_agent_execution_run_id_fkey"
            columns: ["agent_execution_run_id"]
            isOneToOne: false
            referencedRelation: "agent_execution_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tool_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_events: {
        Row: {
          cache_creation_input_tokens: number | null
          cache_read_input_tokens: number | null
          created_at: string
          estimated_input_tokens: number | null
          failure_code: string | null
          id: string
          input_tokens: number | null
          job_id: string | null
          latency_ms: number | null
          model: string
          operation: string
          output_tokens: number | null
          pricing_version: string | null
          project_id: string | null
          provider: string
          provider_cost_usd: number | null
          status: string
          thinking_tokens: number | null
          user_id: string | null
        }
        Insert: {
          cache_creation_input_tokens?: number | null
          cache_read_input_tokens?: number | null
          created_at?: string
          estimated_input_tokens?: number | null
          failure_code?: string | null
          id?: string
          input_tokens?: number | null
          job_id?: string | null
          latency_ms?: number | null
          model: string
          operation: string
          output_tokens?: number | null
          pricing_version?: string | null
          project_id?: string | null
          provider: string
          provider_cost_usd?: number | null
          status: string
          thinking_tokens?: number | null
          user_id?: string | null
        }
        Update: {
          cache_creation_input_tokens?: number | null
          cache_read_input_tokens?: number | null
          created_at?: string
          estimated_input_tokens?: number | null
          failure_code?: string | null
          id?: string
          input_tokens?: number | null
          job_id?: string | null
          latency_ms?: number | null
          model?: string
          operation?: string
          output_tokens?: number | null
          pricing_version?: string | null
          project_id?: string | null
          provider?: string
          provider_cost_usd?: number | null
          status?: string
          thinking_tokens?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          metadata: Json
          project_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          project_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          project_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_attempt_windows: {
        Row: {
          blocked_until: string | null
          failures: number
          identifier_hash: string
          updated_at: string
          window_started_at: string
        }
        Insert: {
          blocked_until?: string | null
          failures?: number
          identifier_hash: string
          updated_at?: string
          window_started_at?: string
        }
        Update: {
          blocked_until?: string | null
          failures?: number
          identifier_hash?: string
          updated_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      authenticated_browser_sessions: {
        Row: {
          access_mode: string
          created_at: string
          expires_at: string
          failure_code: string | null
          id: string
          origin: string
          project_id: string
          provider: string
          provider_session_id: string
          status: string
          terminated_at: string | null
          updated_at: string
        }
        Insert: {
          access_mode?: string
          created_at?: string
          expires_at: string
          failure_code?: string | null
          id?: string
          origin: string
          project_id: string
          provider: string
          provider_session_id: string
          status?: string
          terminated_at?: string | null
          updated_at?: string
        }
        Update: {
          access_mode?: string
          created_at?: string
          expires_at?: string
          failure_code?: string | null
          id?: string
          origin?: string
          project_id?: string
          provider?: string
          provider_session_id?: string
          status?: string
          terminated_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "authenticated_browser_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      authenticated_product_intelligence_snapshots: {
        Row: {
          access_mode: string
          analyzer_version: string
          completed_at: string | null
          completeness: string | null
          completeness_reasons: string[]
          created_at: string
          failure_code: string | null
          id: string
          origin: string
          pages_inspected: number
          project_id: string
          result: Json | null
          schema_version: string
          session_id: string | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          access_mode?: string
          analyzer_version: string
          completed_at?: string | null
          completeness?: string | null
          completeness_reasons?: string[]
          created_at?: string
          failure_code?: string | null
          id?: string
          origin: string
          pages_inspected?: number
          project_id: string
          result?: Json | null
          schema_version: string
          session_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          access_mode?: string
          analyzer_version?: string
          completed_at?: string | null
          completeness?: string | null
          completeness_reasons?: string[]
          created_at?: string
          failure_code?: string | null
          id?: string
          origin?: string
          pages_inspected?: number
          project_id?: string
          result?: Json | null
          schema_version?: string
          session_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "authenticated_product_intelligence_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "authenticated_product_intelligence_snapshots_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "authenticated_browser_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_credit_accounts: {
        Row: {
          created_at: string
          id: string
          posted_credits: number
          reserved_credits: number
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          posted_credits?: number
          reserved_credits?: number
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          posted_credits?: number
          reserved_credits?: number
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      billing_credit_allocations: {
        Row: {
          capacity_materialized_at: string | null
          consumed_units: number | null
          created_at: string
          credit_account_id: string
          credit_units: number
          grant_id: string
          id: string
          released_at: string | null
          reservation_id: string
          settled_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          capacity_materialized_at?: string | null
          consumed_units?: number | null
          created_at?: string
          credit_account_id: string
          credit_units: number
          grant_id: string
          id?: string
          released_at?: string | null
          reservation_id: string
          settled_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          capacity_materialized_at?: string | null
          consumed_units?: number | null
          created_at?: string
          credit_account_id?: string
          credit_units?: number
          grant_id?: string
          id?: string
          released_at?: string | null
          reservation_id?: string
          settled_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_credit_allocations_credit_account_id_fkey"
            columns: ["credit_account_id"]
            isOneToOne: false
            referencedRelation: "billing_credit_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_credit_allocations_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "billing_credit_grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_credit_allocations_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "billing_credit_reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_credit_grants: {
        Row: {
          allocated_credit_units: number
          created_at: string
          credit_account_id: string
          expired_at: string | null
          expired_credit_units: number
          expires_at: string | null
          external_reference: string | null
          granted_at: string
          id: string
          initial_credit_units: number
          ledger_entry_id: string
          period_end: string | null
          period_start: string | null
          source_kind: string
          status: string
          subscription_id: string | null
          updated_at: string
        }
        Insert: {
          allocated_credit_units?: number
          created_at?: string
          credit_account_id: string
          expired_at?: string | null
          expired_credit_units?: number
          expires_at?: string | null
          external_reference?: string | null
          granted_at?: string
          id?: string
          initial_credit_units: number
          ledger_entry_id: string
          period_end?: string | null
          period_start?: string | null
          source_kind: string
          status?: string
          subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          allocated_credit_units?: number
          created_at?: string
          credit_account_id?: string
          expired_at?: string | null
          expired_credit_units?: number
          expires_at?: string | null
          external_reference?: string | null
          granted_at?: string
          id?: string
          initial_credit_units?: number
          ledger_entry_id?: string
          period_end?: string | null
          period_start?: string | null
          source_kind?: string
          status?: string
          subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_credit_grants_credit_account_id_fkey"
            columns: ["credit_account_id"]
            isOneToOne: false
            referencedRelation: "billing_credit_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_credit_grants_ledger_entry_id_fkey"
            columns: ["ledger_entry_id"]
            isOneToOne: false
            referencedRelation: "billing_credit_ledger"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_credit_ledger: {
        Row: {
          created_at: string
          credit_account_id: string
          credit_delta: number
          id: string
          idempotency_key: string
          kind: string
          materialized_at: string | null
          operation_run_id: string | null
          project_id: string | null
          rate_card_version: string | null
          reason: string | null
          refunds_ledger_entry_id: string | null
          reservation_id: string | null
        }
        Insert: {
          created_at?: string
          credit_account_id: string
          credit_delta: number
          id?: string
          idempotency_key: string
          kind: string
          materialized_at?: string | null
          operation_run_id?: string | null
          project_id?: string | null
          rate_card_version?: string | null
          reason?: string | null
          refunds_ledger_entry_id?: string | null
          reservation_id?: string | null
        }
        Update: {
          created_at?: string
          credit_account_id?: string
          credit_delta?: number
          id?: string
          idempotency_key?: string
          kind?: string
          materialized_at?: string | null
          operation_run_id?: string | null
          project_id?: string | null
          rate_card_version?: string | null
          reason?: string | null
          refunds_ledger_entry_id?: string | null
          reservation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_credit_ledger_credit_account_id_fkey"
            columns: ["credit_account_id"]
            isOneToOne: false
            referencedRelation: "billing_credit_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_credit_ledger_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_credit_ledger_refunds_ledger_entry_id_fkey"
            columns: ["refunds_ledger_entry_id"]
            isOneToOne: false
            referencedRelation: "billing_credit_ledger"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_credit_quotes: {
        Row: {
          assumptions: Json
          created_at: string
          credit_account_id: string
          estimated_credits: number
          expires_at: string | null
          id: string
          maximum_credits: number
          operation_run_id: string | null
          operation_type: string
          project_id: string | null
          rate_card_version: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assumptions?: Json
          created_at?: string
          credit_account_id: string
          estimated_credits: number
          expires_at?: string | null
          id?: string
          maximum_credits: number
          operation_run_id?: string | null
          operation_type: string
          project_id?: string | null
          rate_card_version?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assumptions?: Json
          created_at?: string
          credit_account_id?: string
          estimated_credits?: number
          expires_at?: string | null
          id?: string
          maximum_credits?: number
          operation_run_id?: string | null
          operation_type?: string
          project_id?: string | null
          rate_card_version?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_credit_quotes_credit_account_id_fkey"
            columns: ["credit_account_id"]
            isOneToOne: false
            referencedRelation: "billing_credit_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_credit_quotes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_credit_reservations: {
        Row: {
          admitted_at: string | null
          created_at: string
          credit_account_id: string
          expires_at: string | null
          hold_released_at: string | null
          id: string
          idempotency_key: string
          operation_run_id: string | null
          project_id: string | null
          quote_id: string | null
          rate_card_version: string | null
          release_reason: string | null
          released_at: string | null
          reserved_credits: number
          settled_at: string | null
          settled_credits: number | null
          status: string
          updated_at: string
        }
        Insert: {
          admitted_at?: string | null
          created_at?: string
          credit_account_id: string
          expires_at?: string | null
          hold_released_at?: string | null
          id?: string
          idempotency_key: string
          operation_run_id?: string | null
          project_id?: string | null
          quote_id?: string | null
          rate_card_version?: string | null
          release_reason?: string | null
          released_at?: string | null
          reserved_credits: number
          settled_at?: string | null
          settled_credits?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          admitted_at?: string | null
          created_at?: string
          credit_account_id?: string
          expires_at?: string | null
          hold_released_at?: string | null
          id?: string
          idempotency_key?: string
          operation_run_id?: string | null
          project_id?: string | null
          quote_id?: string | null
          rate_card_version?: string | null
          release_reason?: string | null
          released_at?: string | null
          reserved_credits?: number
          settled_at?: string | null
          settled_credits?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_credit_reservations_credit_account_id_fkey"
            columns: ["credit_account_id"]
            isOneToOne: false
            referencedRelation: "billing_credit_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_credit_reservations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_stripe_customers: {
        Row: {
          created_at: string
          id: string
          livemode: boolean
          stripe_customer_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          livemode?: boolean
          stripe_customer_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          livemode?: boolean
          stripe_customer_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      billing_stripe_events: {
        Row: {
          event_type: string
          id: string
          livemode: boolean
          outcome_reason: string | null
          processed_at: string | null
          received_at: string
          status: string
          stripe_event_id: string
          updated_at: string
        }
        Insert: {
          event_type: string
          id?: string
          livemode?: boolean
          outcome_reason?: string | null
          processed_at?: string | null
          received_at?: string
          status?: string
          stripe_event_id: string
          updated_at?: string
        }
        Update: {
          event_type?: string
          id?: string
          livemode?: boolean
          outcome_reason?: string | null
          processed_at?: string | null
          received_at?: string
          status?: string
          stripe_event_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      billing_subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          livemode: boolean
          plan_key: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          livemode?: boolean
          plan_key: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          livemode?: boolean
          plan_key?: string
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      billing_usage_events: {
        Row: {
          cost_status: string
          created_at: string
          id: string
          occurred_at: string
          operation_run_id: string | null
          project_id: string | null
          provider: string
          provider_pricing_version: string | null
          quantity: number
          rate_card_version: string | null
          rated_credits: number | null
          rating_status: string
          raw_cost_nano_usd: number | null
          sku: string
          source_id: string
          source_kind: string
          user_id: string | null
        }
        Insert: {
          cost_status: string
          created_at?: string
          id?: string
          occurred_at: string
          operation_run_id?: string | null
          project_id?: string | null
          provider: string
          provider_pricing_version?: string | null
          quantity: number
          rate_card_version?: string | null
          rated_credits?: number | null
          rating_status?: string
          raw_cost_nano_usd?: number | null
          sku: string
          source_id: string
          source_kind: string
          user_id?: string | null
        }
        Update: {
          cost_status?: string
          created_at?: string
          id?: string
          occurred_at?: string
          operation_run_id?: string | null
          project_id?: string | null
          provider?: string
          provider_pricing_version?: string | null
          quantity?: number
          rate_card_version?: string | null
          rated_credits?: number | null
          rating_status?: string
          raw_cost_nano_usd?: number | null
          sku?: string
          source_id?: string
          source_kind?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_usage_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      browser_runtime_images: {
        Row: {
          built_at: string
          expires_at: string
          id: string
          runtime_version: string
          snapshot_id: string
        }
        Insert: {
          built_at?: string
          expires_at: string
          id?: string
          runtime_version: string
          snapshot_id: string
        }
        Update: {
          built_at?: string
          expires_at?: string
          id?: string
          runtime_version?: string
          snapshot_id?: string
        }
        Relationships: []
      }
      business_opportunities: {
        Row: {
          category: string
          confidence: string
          created_at: string
          dependencies: Json
          effort: string
          evidence_ids: Json
          execution_readiness: string
          execution_type: string
          id: string
          impact: string
          opportunity_set_id: string
          primary_dimension: string | null
          primary_lens: string | null
          problem: string
          rank: number
          secondary_dimensions: Json
          secondary_lenses: Json
          source_conclusion_key: string | null
          title: string
          why_now: string
        }
        Insert: {
          category: string
          confidence: string
          created_at?: string
          dependencies?: Json
          effort: string
          evidence_ids?: Json
          execution_readiness: string
          execution_type: string
          id?: string
          impact: string
          opportunity_set_id: string
          primary_dimension?: string | null
          primary_lens?: string | null
          problem: string
          rank: number
          secondary_dimensions?: Json
          secondary_lenses?: Json
          source_conclusion_key?: string | null
          title: string
          why_now: string
        }
        Update: {
          category?: string
          confidence?: string
          created_at?: string
          dependencies?: Json
          effort?: string
          evidence_ids?: Json
          execution_readiness?: string
          execution_type?: string
          id?: string
          impact?: string
          opportunity_set_id?: string
          primary_dimension?: string | null
          primary_lens?: string | null
          problem?: string
          rank?: number
          secondary_dimensions?: Json
          secondary_lenses?: Json
          source_conclusion_key?: string | null
          title?: string
          why_now?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_opportunities_opportunity_set_id_fkey"
            columns: ["opportunity_set_id"]
            isOneToOne: false
            referencedRelation: "opportunity_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      business_outcome_measurements: {
        Row: {
          baseline_end: string
          baseline_start: string
          baseline_value: number | null
          change_merge_id: string
          completed_at: string | null
          created_at: string
          data_quality: string | null
          evidence_schema_version: string
          failure_code: string | null
          id: string
          measurement_end: string
          measurement_identity: string
          measurement_plan_id: string
          measurement_policy_version: string
          measurement_profile_version: string
          measurement_start: string
          measurement_timezone: string
          metric_aggregation: string
          metric_direction: string
          metric_key: string
          metric_source_kind: string | null
          next_observation_at: string | null
          observed_absolute_change: number | null
          observed_relative_change: number | null
          observed_value: number | null
          operation_run_id: string | null
          project_id: string
          provenance: Json
          sample_size_after: number | null
          sample_size_before: number | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          baseline_end: string
          baseline_start: string
          baseline_value?: number | null
          change_merge_id: string
          completed_at?: string | null
          created_at?: string
          data_quality?: string | null
          evidence_schema_version: string
          failure_code?: string | null
          id?: string
          measurement_end: string
          measurement_identity: string
          measurement_plan_id: string
          measurement_policy_version: string
          measurement_profile_version: string
          measurement_start: string
          measurement_timezone: string
          metric_aggregation: string
          metric_direction: string
          metric_key: string
          metric_source_kind?: string | null
          next_observation_at?: string | null
          observed_absolute_change?: number | null
          observed_relative_change?: number | null
          observed_value?: number | null
          operation_run_id?: string | null
          project_id: string
          provenance?: Json
          sample_size_after?: number | null
          sample_size_before?: number | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          baseline_end?: string
          baseline_start?: string
          baseline_value?: number | null
          change_merge_id?: string
          completed_at?: string | null
          created_at?: string
          data_quality?: string | null
          evidence_schema_version?: string
          failure_code?: string | null
          id?: string
          measurement_end?: string
          measurement_identity?: string
          measurement_plan_id?: string
          measurement_policy_version?: string
          measurement_profile_version?: string
          measurement_start?: string
          measurement_timezone?: string
          metric_aggregation?: string
          metric_direction?: string
          metric_key?: string
          metric_source_kind?: string | null
          next_observation_at?: string | null
          observed_absolute_change?: number | null
          observed_relative_change?: number | null
          observed_value?: number | null
          operation_run_id?: string | null
          project_id?: string
          provenance?: Json
          sample_size_after?: number | null
          sample_size_before?: number | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_outcome_measurements_change_merge_id_fkey"
            columns: ["change_merge_id"]
            isOneToOne: false
            referencedRelation: "change_merges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_outcome_measurements_measurement_plan_id_fkey"
            columns: ["measurement_plan_id"]
            isOneToOne: false
            referencedRelation: "measurement_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_outcome_measurements_operation_run_id_fkey"
            columns: ["operation_run_id"]
            isOneToOne: false
            referencedRelation: "operation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_outcome_measurements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      business_readiness_audits: {
        Row: {
          access_mode: string
          asked_intents: string[]
          assessed_dimensions: number | null
          assessed_lenses: number | null
          audit_version: string
          business_context_hash: string
          completed_at: string | null
          created_at: string
          eligible_lenses: number | null
          evidence_pack_version: string
          failure_code: string | null
          founder_intent_hash: string | null
          id: string
          input_hash: string
          live_snapshot_id: string
          model: string
          overall_score: number | null
          pending_question: Json | null
          product_profile_builder_version: string | null
          product_profile_id: string | null
          product_profile_schema_version: string | null
          project_id: string
          prompt_version: string
          provider: string
          repository_snapshot_id: string
          result: Json | null
          rubric_version: string
          schema_version: string
          started_at: string | null
          status: string
          total_dimensions: number | null
          updated_at: string
        }
        Insert: {
          access_mode: string
          asked_intents?: string[]
          assessed_dimensions?: number | null
          assessed_lenses?: number | null
          audit_version: string
          business_context_hash: string
          completed_at?: string | null
          created_at?: string
          eligible_lenses?: number | null
          evidence_pack_version: string
          failure_code?: string | null
          founder_intent_hash?: string | null
          id?: string
          input_hash: string
          live_snapshot_id: string
          model: string
          overall_score?: number | null
          pending_question?: Json | null
          product_profile_builder_version?: string | null
          product_profile_id?: string | null
          product_profile_schema_version?: string | null
          project_id: string
          prompt_version: string
          provider: string
          repository_snapshot_id: string
          result?: Json | null
          rubric_version: string
          schema_version: string
          started_at?: string | null
          status?: string
          total_dimensions?: number | null
          updated_at?: string
        }
        Update: {
          access_mode?: string
          asked_intents?: string[]
          assessed_dimensions?: number | null
          assessed_lenses?: number | null
          audit_version?: string
          business_context_hash?: string
          completed_at?: string | null
          created_at?: string
          eligible_lenses?: number | null
          evidence_pack_version?: string
          failure_code?: string | null
          founder_intent_hash?: string | null
          id?: string
          input_hash?: string
          live_snapshot_id?: string
          model?: string
          overall_score?: number | null
          pending_question?: Json | null
          product_profile_builder_version?: string | null
          product_profile_id?: string | null
          product_profile_schema_version?: string | null
          project_id?: string
          prompt_version?: string
          provider?: string
          repository_snapshot_id?: string
          result?: Json | null
          rubric_version?: string
          schema_version?: string
          started_at?: string | null
          status?: string
          total_dimensions?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_readiness_audits_live_snapshot_id_fkey"
            columns: ["live_snapshot_id"]
            isOneToOne: false
            referencedRelation: "live_product_intelligence_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_readiness_audits_product_profile_id_fkey"
            columns: ["product_profile_id"]
            isOneToOne: false
            referencedRelation: "product_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_readiness_audits_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_readiness_audits_repository_snapshot_id_fkey"
            columns: ["repository_snapshot_id"]
            isOneToOne: false
            referencedRelation: "repository_intelligence_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      change_approvals: {
        Row: {
          approval_identity: string
          approval_policy_version: string
          approved_at: string
          code_review_digest: string | null
          created_at: string
          id: string
          invalidated_at: string | null
          invalidation_reason: string | null
          prepared_base_sha: string
          prepared_change_id: string
          prepared_commit_sha: string
          preview_session_id: string | null
          project_id: string
          review_artifact_id: string | null
          review_classification: string | null
          review_classification_policy_version: string | null
          revoked_at: string | null
          status: string
          updated_at: string
          user_id: string
          validation_run_id: string
        }
        Insert: {
          approval_identity: string
          approval_policy_version: string
          approved_at?: string
          code_review_digest?: string | null
          created_at?: string
          id?: string
          invalidated_at?: string | null
          invalidation_reason?: string | null
          prepared_base_sha: string
          prepared_change_id: string
          prepared_commit_sha: string
          preview_session_id?: string | null
          project_id: string
          review_artifact_id?: string | null
          review_classification?: string | null
          review_classification_policy_version?: string | null
          revoked_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
          validation_run_id: string
        }
        Update: {
          approval_identity?: string
          approval_policy_version?: string
          approved_at?: string
          code_review_digest?: string | null
          created_at?: string
          id?: string
          invalidated_at?: string | null
          invalidation_reason?: string | null
          prepared_base_sha?: string
          prepared_change_id?: string
          prepared_commit_sha?: string
          preview_session_id?: string | null
          project_id?: string
          review_artifact_id?: string | null
          review_classification?: string | null
          review_classification_policy_version?: string | null
          revoked_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          validation_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "change_approvals_prepared_change_id_fkey"
            columns: ["prepared_change_id"]
            isOneToOne: false
            referencedRelation: "prepared_changes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_approvals_preview_session_id_fkey"
            columns: ["preview_session_id"]
            isOneToOne: false
            referencedRelation: "preview_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_approvals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_approvals_review_artifact_id_fkey"
            columns: ["review_artifact_id"]
            isOneToOne: false
            referencedRelation: "review_artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_approvals_validation_run_id_fkey"
            columns: ["validation_run_id"]
            isOneToOne: false
            referencedRelation: "validation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      change_merges: {
        Row: {
          change_approval_id: string
          created_at: string
          default_branch: string
          failed_at: string | null
          failure_code: string | null
          id: string
          merge_identity: string
          merge_policy_version: string
          merge_strategy: string
          merged_at: string | null
          observed_default_head_before: string | null
          operation_run_id: string | null
          preflight_checked_at: string | null
          prepared_base_sha: string
          prepared_change_id: string
          prepared_commit_sha: string
          project_id: string
          repository_connection_id: string
          resulting_default_head_sha: string | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          change_approval_id: string
          created_at?: string
          default_branch: string
          failed_at?: string | null
          failure_code?: string | null
          id?: string
          merge_identity: string
          merge_policy_version: string
          merge_strategy?: string
          merged_at?: string | null
          observed_default_head_before?: string | null
          operation_run_id?: string | null
          preflight_checked_at?: string | null
          prepared_base_sha: string
          prepared_change_id: string
          prepared_commit_sha: string
          project_id: string
          repository_connection_id: string
          resulting_default_head_sha?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          change_approval_id?: string
          created_at?: string
          default_branch?: string
          failed_at?: string | null
          failure_code?: string | null
          id?: string
          merge_identity?: string
          merge_policy_version?: string
          merge_strategy?: string
          merged_at?: string | null
          observed_default_head_before?: string | null
          operation_run_id?: string | null
          preflight_checked_at?: string | null
          prepared_base_sha?: string
          prepared_change_id?: string
          prepared_commit_sha?: string
          project_id?: string
          repository_connection_id?: string
          resulting_default_head_sha?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "change_merges_change_approval_id_fkey"
            columns: ["change_approval_id"]
            isOneToOne: false
            referencedRelation: "change_approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_merges_operation_run_id_fkey"
            columns: ["operation_run_id"]
            isOneToOne: false
            referencedRelation: "operation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_merges_prepared_change_id_fkey"
            columns: ["prepared_change_id"]
            isOneToOne: false
            referencedRelation: "prepared_changes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_merges_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_merges_repository_connection_id_fkey"
            columns: ["repository_connection_id"]
            isOneToOne: false
            referencedRelation: "repository_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      change_outcome_verifications: {
        Row: {
          attempt_count: number
          capability: string
          capability_version: string
          change_approval_id: string
          change_merge_id: string
          check_results: Json | null
          completed_at: string | null
          created_at: string
          effective_origin: string | null
          evidence_schema_version: string
          expected_outcome: Json
          failure_code: string | null
          id: string
          merged_commit_sha: string
          observation_completed_at: string | null
          observation_started_at: string | null
          operation_run_id: string | null
          outcome_policy_version: string
          outcome_profile: string
          outcome_profile_version: string
          prepared_change_id: string
          project_id: string
          public_origin: string
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
          verification_identity: string
          verification_window_ends_at: string | null
          verification_window_started_at: string | null
        }
        Insert: {
          attempt_count?: number
          capability: string
          capability_version: string
          change_approval_id: string
          change_merge_id: string
          check_results?: Json | null
          completed_at?: string | null
          created_at?: string
          effective_origin?: string | null
          evidence_schema_version: string
          expected_outcome: Json
          failure_code?: string | null
          id?: string
          merged_commit_sha: string
          observation_completed_at?: string | null
          observation_started_at?: string | null
          operation_run_id?: string | null
          outcome_policy_version: string
          outcome_profile: string
          outcome_profile_version: string
          prepared_change_id: string
          project_id: string
          public_origin: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
          verification_identity: string
          verification_window_ends_at?: string | null
          verification_window_started_at?: string | null
        }
        Update: {
          attempt_count?: number
          capability?: string
          capability_version?: string
          change_approval_id?: string
          change_merge_id?: string
          check_results?: Json | null
          completed_at?: string | null
          created_at?: string
          effective_origin?: string | null
          evidence_schema_version?: string
          expected_outcome?: Json
          failure_code?: string | null
          id?: string
          merged_commit_sha?: string
          observation_completed_at?: string | null
          observation_started_at?: string | null
          operation_run_id?: string | null
          outcome_policy_version?: string
          outcome_profile?: string
          outcome_profile_version?: string
          prepared_change_id?: string
          project_id?: string
          public_origin?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          verification_identity?: string
          verification_window_ends_at?: string | null
          verification_window_started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "change_outcome_verifications_change_approval_id_fkey"
            columns: ["change_approval_id"]
            isOneToOne: false
            referencedRelation: "change_approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_outcome_verifications_change_merge_id_fkey"
            columns: ["change_merge_id"]
            isOneToOne: false
            referencedRelation: "change_merges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_outcome_verifications_operation_run_id_fkey"
            columns: ["operation_run_id"]
            isOneToOne: false
            referencedRelation: "operation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_outcome_verifications_prepared_change_id_fkey"
            columns: ["prepared_change_id"]
            isOneToOne: false
            referencedRelation: "prepared_changes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_outcome_verifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      deep_scan_provider_usage: {
        Row: {
          access_mode: string
          active_cpu_ms: number | null
          cost_pricing_version: string | null
          created_at: string
          duration_ms: number
          ended_at: string
          estimated_cost_nano_usd: number | null
          id: string
          network_egress_bytes: number | null
          operation: string
          pages_inspected: number | null
          project_id: string | null
          provider: string
          provider_cost_usd: number | null
          session_id: string | null
          started_at: string
          status: string
          vcpus: number | null
        }
        Insert: {
          access_mode: string
          active_cpu_ms?: number | null
          cost_pricing_version?: string | null
          created_at?: string
          duration_ms: number
          ended_at: string
          estimated_cost_nano_usd?: number | null
          id?: string
          network_egress_bytes?: number | null
          operation: string
          pages_inspected?: number | null
          project_id?: string | null
          provider: string
          provider_cost_usd?: number | null
          session_id?: string | null
          started_at: string
          status: string
          vcpus?: number | null
        }
        Update: {
          access_mode?: string
          active_cpu_ms?: number | null
          cost_pricing_version?: string | null
          created_at?: string
          duration_ms?: number
          ended_at?: string
          estimated_cost_nano_usd?: number | null
          id?: string
          network_egress_bytes?: number | null
          operation?: string
          pages_inspected?: number | null
          project_id?: string | null
          provider?: string
          provider_cost_usd?: number | null
          session_id?: string | null
          started_at?: string
          status?: string
          vcpus?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "deep_scan_provider_usage_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deep_scan_provider_usage_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "authenticated_browser_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_interrupts: {
        Row: {
          agent_execution_run_id: string
          answer: Json | null
          answered_at: string | null
          created_at: string
          execution_spec_id: string
          founder_input_request_id: string | null
          id: string
          interrupt_type: string
          project_id: string
          question: string
          response_schema: Json
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_execution_run_id: string
          answer?: Json | null
          answered_at?: string | null
          created_at?: string
          execution_spec_id: string
          founder_input_request_id?: string | null
          id?: string
          interrupt_type: string
          project_id: string
          question: string
          response_schema: Json
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_execution_run_id?: string
          answer?: Json | null
          answered_at?: string | null
          created_at?: string
          execution_spec_id?: string
          founder_input_request_id?: string | null
          id?: string
          interrupt_type?: string
          project_id?: string
          question?: string
          response_schema?: Json
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_interrupts_agent_execution_run_id_fkey"
            columns: ["agent_execution_run_id"]
            isOneToOne: false
            referencedRelation: "agent_execution_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_interrupts_execution_spec_id_fkey"
            columns: ["execution_spec_id"]
            isOneToOne: false
            referencedRelation: "execution_specs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_interrupts_founder_input_request_id_fkey"
            columns: ["founder_input_request_id"]
            isOneToOne: false
            referencedRelation: "project_founder_input_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_interrupts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_specs: {
        Row: {
          action_plan_id: string
          base_sha: string
          business_audit_id: string
          capability: string | null
          capability_version: string | null
          chain_step_keys: string[]
          chain_step_orders: number[]
          created_at: string
          credit_quote_id: string | null
          execution_class: string | null
          id: string
          max_authorized_credits: number | null
          mode: string
          opportunity_id: string
          policy_version: string
          project_id: string
          repository_connection_id: string
          repository_snapshot_id: string
          resolver_version: string
          risk_class: string
          risk_policy_version: string
          schema_version: string
          spec: Json
          spec_identity: string
          step_key: string
          step_order: number
        }
        Insert: {
          action_plan_id: string
          base_sha: string
          business_audit_id: string
          capability?: string | null
          capability_version?: string | null
          chain_step_keys?: string[]
          chain_step_orders?: number[]
          created_at?: string
          credit_quote_id?: string | null
          execution_class?: string | null
          id?: string
          max_authorized_credits?: number | null
          mode: string
          opportunity_id: string
          policy_version: string
          project_id: string
          repository_connection_id: string
          repository_snapshot_id: string
          resolver_version: string
          risk_class: string
          risk_policy_version: string
          schema_version: string
          spec: Json
          spec_identity: string
          step_key: string
          step_order: number
        }
        Update: {
          action_plan_id?: string
          base_sha?: string
          business_audit_id?: string
          capability?: string | null
          capability_version?: string | null
          chain_step_keys?: string[]
          chain_step_orders?: number[]
          created_at?: string
          credit_quote_id?: string | null
          execution_class?: string | null
          id?: string
          max_authorized_credits?: number | null
          mode?: string
          opportunity_id?: string
          policy_version?: string
          project_id?: string
          repository_connection_id?: string
          repository_snapshot_id?: string
          resolver_version?: string
          risk_class?: string
          risk_policy_version?: string
          schema_version?: string
          spec?: Json
          spec_identity?: string
          step_key?: string
          step_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "execution_specs_action_plan_id_fkey"
            columns: ["action_plan_id"]
            isOneToOne: false
            referencedRelation: "action_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_specs_business_audit_id_fkey"
            columns: ["business_audit_id"]
            isOneToOne: false
            referencedRelation: "business_readiness_audits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_specs_credit_quote_id_fkey"
            columns: ["credit_quote_id"]
            isOneToOne: false
            referencedRelation: "billing_credit_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_specs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_specs_repository_connection_id_fkey"
            columns: ["repository_connection_id"]
            isOneToOne: false
            referencedRelation: "repository_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_specs_repository_snapshot_id_fkey"
            columns: ["repository_snapshot_id"]
            isOneToOne: false
            referencedRelation: "repository_intelligence_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      free_audit_grants: {
        Row: {
          audit_id: string | null
          consumed_at: string
          github_repository_id: number
          id: string
          user_id: string
        }
        Insert: {
          audit_id?: string | null
          consumed_at?: string
          github_repository_id: number
          id?: string
          user_id: string
        }
        Update: {
          audit_id?: string | null
          consumed_at?: string
          github_repository_id?: number
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "free_audit_grants_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "business_readiness_audits"
            referencedColumns: ["id"]
          },
        ]
      }
      github_connections: {
        Row: {
          created_at: string
          github_login: string
          github_user_id: number
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          github_login: string
          github_user_id: number
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          github_login?: string
          github_user_id?: number
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      github_installations: {
        Row: {
          access_revoked_at: string | null
          account_type: string
          created_at: string
          github_account_id: number
          github_account_login: string
          id: string
          installation_id: number
          repository_selection: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_revoked_at?: string | null
          account_type: string
          created_at?: string
          github_account_id: number
          github_account_login: string
          id?: string
          installation_id: number
          repository_selection: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_revoked_at?: string | null
          account_type?: string
          created_at?: string
          github_account_id?: number
          github_account_login?: string
          id?: string
          installation_id?: number
          repository_selection?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      live_product_intelligence_snapshots: {
        Row: {
          analyzer_version: string
          completed_at: string | null
          completeness: string | null
          completeness_reasons: string[]
          configured_url: string
          created_at: string
          failure_code: string | null
          id: string
          project_id: string
          result: Json | null
          schema_version: string
          source_origin: string
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          analyzer_version: string
          completed_at?: string | null
          completeness?: string | null
          completeness_reasons?: string[]
          configured_url: string
          created_at?: string
          failure_code?: string | null
          id?: string
          project_id: string
          result?: Json | null
          schema_version: string
          source_origin: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          analyzer_version?: string
          completed_at?: string | null
          completeness?: string | null
          completeness_reasons?: string[]
          configured_url?: string
          created_at?: string
          failure_code?: string | null
          id?: string
          project_id?: string
          result?: Json | null
          schema_version?: string
          source_origin?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_product_intelligence_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      measurement_plans: {
        Row: {
          baseline_days: number
          business_goal: string
          change_merge_id: string
          compatible_source_kinds: string[]
          created_at: string
          id: string
          measurement_days: number
          measurement_policy_version: string
          measurement_profile: string
          measurement_profile_version: string
          metric_category: string
          metric_direction: string
          minimum_observations: number
          prepared_change_id: string
          primary_metric: string
          project_id: string
          secondary_metrics: string[]
          settling_days: number
          status: string
          unsupported_reason: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          baseline_days: number
          business_goal: string
          change_merge_id: string
          compatible_source_kinds?: string[]
          created_at?: string
          id?: string
          measurement_days: number
          measurement_policy_version: string
          measurement_profile: string
          measurement_profile_version: string
          metric_category: string
          metric_direction: string
          minimum_observations: number
          prepared_change_id: string
          primary_metric: string
          project_id: string
          secondary_metrics?: string[]
          settling_days?: number
          status?: string
          unsupported_reason?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          baseline_days?: number
          business_goal?: string
          change_merge_id?: string
          compatible_source_kinds?: string[]
          created_at?: string
          id?: string
          measurement_days?: number
          measurement_policy_version?: string
          measurement_profile?: string
          measurement_profile_version?: string
          metric_category?: string
          metric_direction?: string
          minimum_observations?: number
          prepared_change_id?: string
          primary_metric?: string
          project_id?: string
          secondary_metrics?: string[]
          settling_days?: number
          status?: string
          unsupported_reason?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "measurement_plans_change_merge_id_fkey"
            columns: ["change_merge_id"]
            isOneToOne: false
            referencedRelation: "change_merges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_plans_prepared_change_id_fkey"
            columns: ["prepared_change_id"]
            isOneToOne: false
            referencedRelation: "prepared_changes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      nova_voice_messages: {
        Row: {
          claimed_at: string
          fallback_reason: string | null
          identity: string
          locale: string
          message: string | null
          model: string
          policy_version: string
          project_id: string
          prompt_version: string
          resolved_at: string | null
          slot: string
          source: string | null
        }
        Insert: {
          claimed_at?: string
          fallback_reason?: string | null
          identity: string
          locale: string
          message?: string | null
          model: string
          policy_version: string
          project_id: string
          prompt_version: string
          resolved_at?: string | null
          slot: string
          source?: string | null
        }
        Update: {
          claimed_at?: string
          fallback_reason?: string | null
          identity?: string
          locale?: string
          message?: string | null
          model?: string
          policy_version?: string
          project_id?: string
          prompt_version?: string
          resolved_at?: string | null
          slot?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nova_voice_messages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      operation_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          execution_provider: string | null
          failure_code: string | null
          id: string
          inference_started_at: string | null
          input_identity: string
          operation_type: string
          pause_cycle: number
          project_id: string | null
          result_id: string | null
          stage: string
          started_at: string | null
          status: string
          subject_id: string | null
          updated_at: string
          user_id: string | null
          workflow_run_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          execution_provider?: string | null
          failure_code?: string | null
          id?: string
          inference_started_at?: string | null
          input_identity: string
          operation_type: string
          pause_cycle?: number
          project_id?: string | null
          result_id?: string | null
          stage?: string
          started_at?: string | null
          status?: string
          subject_id?: string | null
          updated_at?: string
          user_id?: string | null
          workflow_run_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          execution_provider?: string | null
          failure_code?: string | null
          id?: string
          inference_started_at?: string | null
          input_identity?: string
          operation_type?: string
          pause_cycle?: number
          project_id?: string | null
          result_id?: string | null
          stage?: string
          started_at?: string | null
          status?: string
          subject_id?: string | null
          updated_at?: string
          user_id?: string | null
          workflow_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operation_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_sets: {
        Row: {
          business_audit_id: string
          completed_at: string | null
          created_at: string
          engine_version: string
          evidence_pack_version: string
          failure_code: string | null
          id: string
          input_hash: string
          model: string
          opportunity_count: number | null
          project_id: string
          prompt_version: string
          provider: string
          rubric_version: string
          schema_version: string
          started_at: string | null
          status: string
          updated_at: string
          validation_notes: Json
        }
        Insert: {
          business_audit_id: string
          completed_at?: string | null
          created_at?: string
          engine_version: string
          evidence_pack_version: string
          failure_code?: string | null
          id?: string
          input_hash: string
          model: string
          opportunity_count?: number | null
          project_id: string
          prompt_version: string
          provider: string
          rubric_version: string
          schema_version: string
          started_at?: string | null
          status?: string
          updated_at?: string
          validation_notes?: Json
        }
        Update: {
          business_audit_id?: string
          completed_at?: string | null
          created_at?: string
          engine_version?: string
          evidence_pack_version?: string
          failure_code?: string | null
          id?: string
          input_hash?: string
          model?: string
          opportunity_count?: number | null
          project_id?: string
          prompt_version?: string
          provider?: string
          rubric_version?: string
          schema_version?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          validation_notes?: Json
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_sets_business_audit_id_fkey"
            columns: ["business_audit_id"]
            isOneToOne: false
            referencedRelation: "business_readiness_audits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_sets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      prepared_changes: {
        Row: {
          base_branch: string
          base_sha: string
          branch_name: string
          commit_sha: string | null
          completed_at: string | null
          created_at: string
          execution_capability: string
          execution_identity: string
          execution_version: string
          failure_code: string | null
          files: Json
          id: string
          operation_run_id: string
          opportunity_id: string | null
          opportunity_set_id: string | null
          project_id: string
          repository_snapshot_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          base_branch: string
          base_sha: string
          branch_name: string
          commit_sha?: string | null
          completed_at?: string | null
          created_at?: string
          execution_capability: string
          execution_identity: string
          execution_version: string
          failure_code?: string | null
          files?: Json
          id?: string
          operation_run_id: string
          opportunity_id?: string | null
          opportunity_set_id?: string | null
          project_id: string
          repository_snapshot_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          base_branch?: string
          base_sha?: string
          branch_name?: string
          commit_sha?: string | null
          completed_at?: string | null
          created_at?: string
          execution_capability?: string
          execution_identity?: string
          execution_version?: string
          failure_code?: string | null
          files?: Json
          id?: string
          operation_run_id?: string
          opportunity_id?: string | null
          opportunity_set_id?: string | null
          project_id?: string
          repository_snapshot_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prepared_changes_operation_run_id_fkey"
            columns: ["operation_run_id"]
            isOneToOne: false
            referencedRelation: "operation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prepared_changes_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "business_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prepared_changes_opportunity_set_id_fkey"
            columns: ["opportunity_set_id"]
            isOneToOne: false
            referencedRelation: "opportunity_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prepared_changes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prepared_changes_repository_snapshot_id_fkey"
            columns: ["repository_snapshot_id"]
            isOneToOne: false
            referencedRelation: "repository_intelligence_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      preview_sessions: {
        Row: {
          artifact_deleted_at: string | null
          artifact_snapshot_id: string | null
          cleanup_status: string | null
          created_at: string
          expires_at: string
          failure_code: string | null
          id: string
          operation_run_id: string
          port: number
          prepared_change_id: string
          prepared_commit_sha: string
          preview_identity: string
          preview_policy_version: string
          preview_profile: string
          preview_profile_version: string
          project_id: string
          provider: string
          ready_at: string | null
          runtime: string | null
          stage: string
          started_at: string | null
          status: string
          stopped_at: string | null
          teardown_reason: string | null
          updated_at: string
          user_id: string
          validation_run_id: string | null
        }
        Insert: {
          artifact_deleted_at?: string | null
          artifact_snapshot_id?: string | null
          cleanup_status?: string | null
          created_at?: string
          expires_at: string
          failure_code?: string | null
          id?: string
          operation_run_id: string
          port: number
          prepared_change_id: string
          prepared_commit_sha: string
          preview_identity: string
          preview_policy_version: string
          preview_profile: string
          preview_profile_version: string
          project_id: string
          provider: string
          ready_at?: string | null
          runtime?: string | null
          stage?: string
          started_at?: string | null
          status?: string
          stopped_at?: string | null
          teardown_reason?: string | null
          updated_at?: string
          user_id: string
          validation_run_id?: string | null
        }
        Update: {
          artifact_deleted_at?: string | null
          artifact_snapshot_id?: string | null
          cleanup_status?: string | null
          created_at?: string
          expires_at?: string
          failure_code?: string | null
          id?: string
          operation_run_id?: string
          port?: number
          prepared_change_id?: string
          prepared_commit_sha?: string
          preview_identity?: string
          preview_policy_version?: string
          preview_profile?: string
          preview_profile_version?: string
          project_id?: string
          provider?: string
          ready_at?: string | null
          runtime?: string | null
          stage?: string
          started_at?: string | null
          status?: string
          stopped_at?: string | null
          teardown_reason?: string | null
          updated_at?: string
          user_id?: string
          validation_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "preview_sessions_operation_run_id_fkey"
            columns: ["operation_run_id"]
            isOneToOne: false
            referencedRelation: "operation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preview_sessions_prepared_change_id_fkey"
            columns: ["prepared_change_id"]
            isOneToOne: false
            referencedRelation: "prepared_changes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preview_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preview_sessions_validation_run_id_fkey"
            columns: ["validation_run_id"]
            isOneToOne: false
            referencedRelation: "validation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      product_profile_corrections: {
        Row: {
          corrections: Json
          created_at: string
          id: string
          project_id: string
          updated_at: string
        }
        Insert: {
          corrections?: Json
          created_at?: string
          id?: string
          project_id: string
          updated_at?: string
        }
        Update: {
          corrections?: Json
          created_at?: string
          id?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_profile_corrections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      product_profiles: {
        Row: {
          authenticated_snapshot_id: string | null
          builder_version: string
          completed_at: string | null
          confirmed_at: string | null
          created_at: string
          evidence_version: string
          failure_code: string | null
          id: string
          input_hash: string
          live_snapshot_id: string | null
          model: string | null
          product_logo_url: string | null
          product_name: string | null
          project_id: string
          prompt_version: string | null
          provider: string | null
          repository_snapshot_id: string | null
          result: Json | null
          schema_version: string
          started_at: string | null
          status: string
          synthesized: boolean
          updated_at: string
        }
        Insert: {
          authenticated_snapshot_id?: string | null
          builder_version: string
          completed_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          evidence_version: string
          failure_code?: string | null
          id?: string
          input_hash: string
          live_snapshot_id?: string | null
          model?: string | null
          product_logo_url?: string | null
          product_name?: string | null
          project_id: string
          prompt_version?: string | null
          provider?: string | null
          repository_snapshot_id?: string | null
          result?: Json | null
          schema_version: string
          started_at?: string | null
          status?: string
          synthesized?: boolean
          updated_at?: string
        }
        Update: {
          authenticated_snapshot_id?: string | null
          builder_version?: string
          completed_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          evidence_version?: string
          failure_code?: string | null
          id?: string
          input_hash?: string
          live_snapshot_id?: string | null
          model?: string | null
          product_logo_url?: string | null
          product_name?: string | null
          project_id?: string
          prompt_version?: string | null
          provider?: string | null
          repository_snapshot_id?: string | null
          result?: Json | null
          schema_version?: string
          started_at?: string | null
          status?: string
          synthesized?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_profiles_authenticated_snapshot_id_fkey"
            columns: ["authenticated_snapshot_id"]
            isOneToOne: false
            referencedRelation: "authenticated_product_intelligence_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_profiles_live_snapshot_id_fkey"
            columns: ["live_snapshot_id"]
            isOneToOne: false
            referencedRelation: "live_product_intelligence_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_profiles_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_profiles_repository_snapshot_id_fkey"
            columns: ["repository_snapshot_id"]
            isOneToOne: false
            referencedRelation: "repository_intelligence_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      product_scan_events: {
        Row: {
          created_at: string
          detail: string | null
          event_key: string
          finding_key: string | null
          id: string
          occurred_at: string
          operation_run_id: string
          phase: string
          project_id: string
          reference_id: string | null
          sequence: number
          source: string
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          event_key: string
          finding_key?: string | null
          id?: string
          occurred_at?: string
          operation_run_id: string
          phase: string
          project_id: string
          reference_id?: string | null
          sequence: number
          source: string
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          event_key?: string
          finding_key?: string | null
          id?: string
          occurred_at?: string
          operation_run_id?: string
          phase?: string
          project_id?: string
          reference_id?: string | null
          sequence?: number
          source?: string
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_scan_events_operation_run_id_fkey"
            columns: ["operation_run_id"]
            isOneToOne: false
            referencedRelation: "operation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_scan_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_founder_input_requests: {
        Row: {
          action_plan_id: string | null
          action_plan_step_key: string | null
          allow_custom: boolean
          alternatives: Json
          context_hash: string
          created_at: string
          execution_interrupt_id: string | null
          id: string
          input_kind: string
          origin: string
          project_id: string
          question: string
          recommendation: Json | null
          resolved_at: string | null
          response_type: string
          status: string
          subject_key: string
          updated_at: string
          why_needed: string
        }
        Insert: {
          action_plan_id?: string | null
          action_plan_step_key?: string | null
          allow_custom?: boolean
          alternatives?: Json
          context_hash: string
          created_at?: string
          execution_interrupt_id?: string | null
          id?: string
          input_kind: string
          origin: string
          project_id: string
          question: string
          recommendation?: Json | null
          resolved_at?: string | null
          response_type: string
          status?: string
          subject_key: string
          updated_at?: string
          why_needed: string
        }
        Update: {
          action_plan_id?: string | null
          action_plan_step_key?: string | null
          allow_custom?: boolean
          alternatives?: Json
          context_hash?: string
          created_at?: string
          execution_interrupt_id?: string | null
          id?: string
          input_kind?: string
          origin?: string
          project_id?: string
          question?: string
          recommendation?: Json | null
          resolved_at?: string | null
          response_type?: string
          status?: string
          subject_key?: string
          updated_at?: string
          why_needed?: string
        }
        Relationships: [
          {
            foreignKeyName: "founder_input_requests_plan_step_fk"
            columns: ["action_plan_id", "action_plan_step_key"]
            isOneToOne: true
            referencedRelation: "action_plan_steps"
            referencedColumns: ["action_plan_id", "step_key"]
          },
          {
            foreignKeyName: "project_founder_input_requests_action_plan_id_fkey"
            columns: ["action_plan_id"]
            isOneToOne: false
            referencedRelation: "action_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_founder_input_requests_execution_interrupt_id_fkey"
            columns: ["execution_interrupt_id"]
            isOneToOne: false
            referencedRelation: "execution_interrupts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_founder_input_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_founder_intent: {
        Row: {
          created_at: string
          id: string
          intent_hash: string
          monetization_model: string | null
          primary_goal: string | null
          project_id: string
          stage: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          intent_hash: string
          monetization_model?: string | null
          primary_goal?: string | null
          project_id: string
          stage?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          intent_hash?: string
          monetization_model?: string | null
          primary_goal?: string | null
          project_id?: string
          stage?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_founder_intent_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_founder_resolutions: {
        Row: {
          context_hash: string
          created_at: string
          id: string
          input_kind: string
          project_id: string
          raw_answer: string | null
          request_id: string
          resolved_statement: string
          response_source: string
          selected_option_id: string | null
          subject_key: string
          superseded_at: string | null
          supersedes_resolution_id: string | null
        }
        Insert: {
          context_hash: string
          created_at?: string
          id?: string
          input_kind: string
          project_id: string
          raw_answer?: string | null
          request_id: string
          resolved_statement: string
          response_source: string
          selected_option_id?: string | null
          subject_key: string
          superseded_at?: string | null
          supersedes_resolution_id?: string | null
        }
        Update: {
          context_hash?: string
          created_at?: string
          id?: string
          input_kind?: string
          project_id?: string
          raw_answer?: string | null
          request_id?: string
          resolved_statement?: string
          response_source?: string
          selected_option_id?: string | null
          subject_key?: string
          superseded_at?: string | null
          supersedes_resolution_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "founder_resolutions_request_project_fk"
            columns: ["request_id", "project_id"]
            isOneToOne: false
            referencedRelation: "project_founder_input_requests"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "project_founder_resolutions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_founder_resolutions_supersedes_resolution_id_fkey"
            columns: ["supersedes_resolution_id"]
            isOneToOne: false
            referencedRelation: "project_founder_resolutions"
            referencedColumns: ["id"]
          },
        ]
      }
      project_onboarding: {
        Row: {
          audit_revealed_at: string | null
          completed_at: string | null
          created_at: string
          first_move_viewed_at: string | null
          live_site_status: string
          nova_introduced_at: string | null
          nova_workflow_status: string
          product_revealed_at: string | null
          project_id: string
          state: string
          updated_at: string
        }
        Insert: {
          audit_revealed_at?: string | null
          completed_at?: string | null
          created_at?: string
          first_move_viewed_at?: string | null
          live_site_status?: string
          nova_introduced_at?: string | null
          nova_workflow_status?: string
          product_revealed_at?: string | null
          project_id: string
          state?: string
          updated_at?: string
        }
        Update: {
          audit_revealed_at?: string | null
          completed_at?: string | null
          created_at?: string
          first_move_viewed_at?: string | null
          live_site_status?: string
          nova_introduced_at?: string | null
          nova_workflow_status?: string
          product_revealed_at?: string | null
          project_id?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_onboarding_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          id: string
          name: string
          production_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          production_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          production_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      repository_connections: {
        Row: {
          created_at: string
          default_branch: string
          detached_at: string | null
          full_name: string
          github_installation_id: string
          github_repository_id: number
          html_url: string
          id: string
          name: string
          owner: string
          private: boolean
          project_id: string
          updated_at: string
          workspace_root: string | null
          workspace_root_chosen_at: string | null
        }
        Insert: {
          created_at?: string
          default_branch: string
          detached_at?: string | null
          full_name: string
          github_installation_id: string
          github_repository_id: number
          html_url: string
          id?: string
          name: string
          owner: string
          private: boolean
          project_id: string
          updated_at?: string
          workspace_root?: string | null
          workspace_root_chosen_at?: string | null
        }
        Update: {
          created_at?: string
          default_branch?: string
          detached_at?: string | null
          full_name?: string
          github_installation_id?: string
          github_repository_id?: number
          html_url?: string
          id?: string
          name?: string
          owner?: string
          private?: boolean
          project_id?: string
          updated_at?: string
          workspace_root?: string | null
          workspace_root_chosen_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repository_connections_github_installation_id_fkey"
            columns: ["github_installation_id"]
            isOneToOne: false
            referencedRelation: "github_installations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repository_connections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      repository_intelligence_snapshots: {
        Row: {
          analyzer_version: string
          completed_at: string | null
          completeness: string | null
          completeness_reasons: string[]
          created_at: string
          failure_code: string | null
          id: string
          project_id: string
          repository_connection_id: string
          result: Json | null
          schema_version: string
          source_branch: string
          source_commit_sha: string
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          analyzer_version: string
          completed_at?: string | null
          completeness?: string | null
          completeness_reasons?: string[]
          created_at?: string
          failure_code?: string | null
          id?: string
          project_id: string
          repository_connection_id: string
          result?: Json | null
          schema_version: string
          source_branch: string
          source_commit_sha: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          analyzer_version?: string
          completed_at?: string | null
          completeness?: string | null
          completeness_reasons?: string[]
          created_at?: string
          failure_code?: string | null
          id?: string
          project_id?: string
          repository_connection_id?: string
          result?: Json | null
          schema_version?: string
          source_branch?: string
          source_commit_sha?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "repository_intelligence_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repository_intelligence_snapshots_repository_connection_id_fkey"
            columns: ["repository_connection_id"]
            isOneToOne: false
            referencedRelation: "repository_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      review_artifacts: {
        Row: {
          after_capture_status: string
          after_captured_at: string | null
          after_height: number | null
          after_object_path: string | null
          after_sha256: string | null
          after_width: number | null
          before_capture_status: string
          before_captured_at: string | null
          before_height: number | null
          before_object_path: string | null
          before_origin: string
          before_sha256: string | null
          before_width: number | null
          created_at: string
          expires_at: string
          failure_code: string | null
          id: string
          operation_run_id: string
          prepared_change_id: string
          preview_session_id: string | null
          project_id: string
          provider: string
          review_identity: string
          review_policy_version: string
          review_profile: string
          review_profile_version: string
          route: string
          status: string
          updated_at: string
          user_id: string
          validation_run_id: string
        }
        Insert: {
          after_capture_status?: string
          after_captured_at?: string | null
          after_height?: number | null
          after_object_path?: string | null
          after_sha256?: string | null
          after_width?: number | null
          before_capture_status?: string
          before_captured_at?: string | null
          before_height?: number | null
          before_object_path?: string | null
          before_origin: string
          before_sha256?: string | null
          before_width?: number | null
          created_at?: string
          expires_at: string
          failure_code?: string | null
          id?: string
          operation_run_id: string
          prepared_change_id: string
          preview_session_id?: string | null
          project_id: string
          provider: string
          review_identity: string
          review_policy_version: string
          review_profile: string
          review_profile_version: string
          route: string
          status?: string
          updated_at?: string
          user_id: string
          validation_run_id: string
        }
        Update: {
          after_capture_status?: string
          after_captured_at?: string | null
          after_height?: number | null
          after_object_path?: string | null
          after_sha256?: string | null
          after_width?: number | null
          before_capture_status?: string
          before_captured_at?: string | null
          before_height?: number | null
          before_object_path?: string | null
          before_origin?: string
          before_sha256?: string | null
          before_width?: number | null
          created_at?: string
          expires_at?: string
          failure_code?: string | null
          id?: string
          operation_run_id?: string
          prepared_change_id?: string
          preview_session_id?: string | null
          project_id?: string
          provider?: string
          review_identity?: string
          review_policy_version?: string
          review_profile?: string
          review_profile_version?: string
          route?: string
          status?: string
          updated_at?: string
          user_id?: string
          validation_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_artifacts_operation_run_id_fkey"
            columns: ["operation_run_id"]
            isOneToOne: false
            referencedRelation: "operation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_artifacts_prepared_change_id_fkey"
            columns: ["prepared_change_id"]
            isOneToOne: false
            referencedRelation: "prepared_changes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_artifacts_preview_session_id_fkey"
            columns: ["preview_session_id"]
            isOneToOne: false
            referencedRelation: "preview_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_artifacts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_artifacts_validation_run_id_fkey"
            columns: ["validation_run_id"]
            isOneToOne: false
            referencedRelation: "validation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      review_browser_usage: {
        Row: {
          captures: number
          created_at: string
          duration_ms: number
          failure_code: string | null
          id: string
          operation: string
          project_id: string | null
          provider: string
          provider_cost_usd: number | null
          review_artifact_id: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          captures: number
          created_at?: string
          duration_ms: number
          failure_code?: string | null
          id?: string
          operation: string
          project_id?: string | null
          provider: string
          provider_cost_usd?: number | null
          review_artifact_id?: string | null
          status: string
          user_id?: string | null
        }
        Update: {
          captures?: number
          created_at?: string
          duration_ms?: number
          failure_code?: string | null
          id?: string
          operation?: string
          project_id?: string | null
          provider?: string
          provider_cost_usd?: number | null
          review_artifact_id?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_browser_usage_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sandbox_usage_events: {
        Row: {
          active_cpu_ms: number | null
          cleanup_status: string | null
          cost_pricing_version: string | null
          created_at: string
          estimated_cost_nano_usd: number | null
          failure_code: string | null
          failure_detail: string | null
          id: string
          network_egress_bytes: number | null
          network_ingress_bytes: number | null
          operation: string
          preview_session_id: string | null
          project_id: string | null
          provider: string
          provider_cost_usd: number | null
          runtime: string | null
          sandbox_duration_ms: number | null
          status: string
          user_id: string | null
          validation_run_id: string | null
          vcpus: number | null
        }
        Insert: {
          active_cpu_ms?: number | null
          cleanup_status?: string | null
          cost_pricing_version?: string | null
          created_at?: string
          estimated_cost_nano_usd?: number | null
          failure_code?: string | null
          failure_detail?: string | null
          id?: string
          network_egress_bytes?: number | null
          network_ingress_bytes?: number | null
          operation: string
          preview_session_id?: string | null
          project_id?: string | null
          provider: string
          provider_cost_usd?: number | null
          runtime?: string | null
          sandbox_duration_ms?: number | null
          status: string
          user_id?: string | null
          validation_run_id?: string | null
          vcpus?: number | null
        }
        Update: {
          active_cpu_ms?: number | null
          cleanup_status?: string | null
          cost_pricing_version?: string | null
          created_at?: string
          estimated_cost_nano_usd?: number | null
          failure_code?: string | null
          failure_detail?: string | null
          id?: string
          network_egress_bytes?: number | null
          network_ingress_bytes?: number | null
          operation?: string
          preview_session_id?: string | null
          project_id?: string | null
          provider?: string
          provider_cost_usd?: number | null
          runtime?: string | null
          sandbox_duration_ms?: number | null
          status?: string
          user_id?: string | null
          validation_run_id?: string | null
          vcpus?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sandbox_usage_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      validation_runs: {
        Row: {
          artifact_deleted_at: string | null
          artifact_expires_at: string | null
          artifact_size_bytes: number | null
          artifact_snapshot_id: string | null
          cleanup_status: string | null
          completed_at: string | null
          created_at: string
          failure_code: string | null
          failure_detail: string | null
          id: string
          install_root: string
          operation_run_id: string
          package_manager: string
          prepared_change_id: string
          prepared_commit_sha: string
          project_id: string
          sandbox_duration_ms: number | null
          sandbox_policy_version: string
          sandbox_provider: string
          sandbox_runtime: string | null
          source_integrity: Json | null
          stage: string
          started_at: string | null
          status: string
          steps: Json
          updated_at: string
          user_id: string
          validation_depth: string | null
          validation_depth_policy_version: string | null
          validation_depth_reason: string | null
          validation_identity: string
          validation_profile: string
          validation_profile_version: string
          workspace_root: string
        }
        Insert: {
          artifact_deleted_at?: string | null
          artifact_expires_at?: string | null
          artifact_size_bytes?: number | null
          artifact_snapshot_id?: string | null
          cleanup_status?: string | null
          completed_at?: string | null
          created_at?: string
          failure_code?: string | null
          failure_detail?: string | null
          id?: string
          install_root?: string
          operation_run_id: string
          package_manager: string
          prepared_change_id: string
          prepared_commit_sha: string
          project_id: string
          sandbox_duration_ms?: number | null
          sandbox_policy_version: string
          sandbox_provider: string
          sandbox_runtime?: string | null
          source_integrity?: Json | null
          stage: string
          started_at?: string | null
          status: string
          steps?: Json
          updated_at?: string
          user_id: string
          validation_depth?: string | null
          validation_depth_policy_version?: string | null
          validation_depth_reason?: string | null
          validation_identity: string
          validation_profile: string
          validation_profile_version: string
          workspace_root?: string
        }
        Update: {
          artifact_deleted_at?: string | null
          artifact_expires_at?: string | null
          artifact_size_bytes?: number | null
          artifact_snapshot_id?: string | null
          cleanup_status?: string | null
          completed_at?: string | null
          created_at?: string
          failure_code?: string | null
          failure_detail?: string | null
          id?: string
          install_root?: string
          operation_run_id?: string
          package_manager?: string
          prepared_change_id?: string
          prepared_commit_sha?: string
          project_id?: string
          sandbox_duration_ms?: number | null
          sandbox_policy_version?: string
          sandbox_provider?: string
          sandbox_runtime?: string | null
          source_integrity?: Json | null
          stage?: string
          started_at?: string | null
          status?: string
          steps?: Json
          updated_at?: string
          user_id?: string
          validation_depth?: string | null
          validation_depth_policy_version?: string | null
          validation_depth_reason?: string | null
          validation_identity?: string
          validation_profile?: string
          validation_profile_version?: string
          workspace_root?: string
        }
        Relationships: [
          {
            foreignKeyName: "validation_runs_operation_run_id_fkey"
            columns: ["operation_run_id"]
            isOneToOne: false
            referencedRelation: "operation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "validation_runs_prepared_change_id_fkey"
            columns: ["prepared_change_id"]
            isOneToOne: false
            referencedRelation: "prepared_changes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "validation_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      attach_repository_to_project: {
        Args: {
          p_default_branch: string
          p_full_name: string
          p_github_repository_id: number
          p_html_url: string
          p_installation_row_id: string
          p_owner: string
          p_private: boolean
          p_project_id: string
          p_repository_name: string
        }
        Returns: {
          connection_id: string
          failure: string
        }[]
      }
      attest_founder_action_step: {
        Args: {
          p_action_plan_id: string
          p_action_plan_step_key: string
          p_project_id: string
          p_user_id: string
        }
        Returns: string
      }
      chain_keys_are_present: { Args: { p_keys: string[] }; Returns: boolean }
      chain_orders_ascend: { Args: { p_orders: number[] }; Returns: boolean }
      claim_gateway_request: { Args: { p_run_id: string }; Returns: number }
      create_project_with_repository: {
        Args: {
          p_default_branch: string
          p_full_name: string
          p_github_repository_id: number
          p_html_url: string
          p_installation_row_id: string
          p_owner: string
          p_private: boolean
          p_project_name: string
          p_repository_name: string
        }
        Returns: {
          failure: string
          project_id: string
        }[]
      }
      detach_repository: {
        Args: { p_project_id: string; p_user_id: string }
        Returns: string
      }
      erase_account_audit_metadata: {
        Args: { p_user_id: string }
        Returns: number
      }
      erase_project_lifecycle: {
        Args: { p_project_id: string; p_user_id: string }
        Returns: boolean
      }
      materialize_allocation_capacity: {
        Args: { p_allocation_id: string }
        Returns: undefined
      }
      materialize_ledger_entry: {
        Args: { p_entry_id: string }
        Returns: undefined
      }
      materialize_reservation_hold: {
        Args: { p_reservation_id: string }
        Returns: undefined
      }
      raise_execution_founder_input_request: {
        Args: {
          p_agent_execution_run_id: string
          p_allow_custom: boolean
          p_alternatives: Json
          p_input_kind: string
          p_interrupt_type: string
          p_question: string
          p_recommendation: Json
          p_response_schema: Json
          p_response_type: string
          p_subject_key: string
          p_why_needed: string
        }
        Returns: {
          execution_interrupt_id: string
          founder_input_request_id: string
        }[]
      }
      record_auth_attempt: {
        Args: { p_identifier_hash: string; p_succeeded: boolean }
        Returns: {
          allowed: boolean
          retry_after_seconds: number
        }[]
      }
      repair_account_balance: {
        Args: { p_account_id: string }
        Returns: undefined
      }
      repair_lot_allocation: {
        Args: { p_grant_id: string }
        Returns: undefined
      }
      resolve_founder_input_request: {
        Args: {
          p_expected_context_hash?: string
          p_raw_answer?: string
          p_request_id: string
          p_response_source: string
          p_selected_option_id?: string
          p_user_id: string
        }
        Returns: string
      }
      retention_sweep: {
        Args: never
        Returns: {
          rows_deleted: number
          swept_table: string
        }[]
      }
      scrub_audit_metadata: {
        Args: { m: Json; p_position?: number }
        Returns: Json
      }
      sum_agent_run_usage: {
        Args: { p_run_id: string }
        Returns: {
          forwarded_requests: number
          spent_output_tokens: number
        }[]
      }
      sum_ledger_deltas: {
        Args: { p_credit_account_id: string }
        Returns: number
      }
      sum_lot_allocation_capacity: {
        Args: { p_grant_ids: string[] }
        Returns: {
          grant_id: string
          occupied_units: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
