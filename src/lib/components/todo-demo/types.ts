export type AgentStatus = 'idle' | 'working' | 'done' | 'awaiting_approval' | 'error';
export type AgentDraftType = 'message' | 'email' | 'research';
export type EmailSignalType = 'interview' | 'follow_up_interview' | 'rejection' | 'acceptance';

export type TodoItem = {
	id: string;
	title: string;
	notes?: string;
	agentLogs?: string;
	threadId?: string;
	agentStatus?: AgentStatus;
	agentSummary?: string;
	agentDraft?: string;
	agentDraftType?: AgentDraftType;
	hasUnreadNotes?: boolean;
	hasUnreadEmailSignal?: boolean;
	emailSignalType?: EmailSignalType;
	emailSignalSummary?: string;
	emailSignalNextAction?: string;
	emailSignalAt?: number;
	emailSignalMessageId?: string;
	agentSpec?: string;
	createdAt?: number;
	targetedAt?: number;
	preparingAt?: number;
	appliedAt?: number;
	interviewingAt?: number;
	doneAt?: number;
	// Job-specific fields
	companyName?: string;
	position?: string;
	jobUrl?: string;
	jobDescription?: string;
	skills?: string;
	country?: string;
	jobLevel?: string;
	jobType?: string;
	platform?: string;
	motivationLetter?: string;
	interviewDate?: string;
	interviewLink?: string;
	interviewEmail?: string;
};

export type ColumnId = 'targeted' | 'preparing' | 'applied' | 'interviewing' | 'done';

export type ColumnMeta = { id: string; name?: string; instructions?: string };

export type KanbanData = Record<ColumnId, TodoItem[]>;
