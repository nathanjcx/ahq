export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type FindingStatus = 'open' | 'addressed' | 'verified' | 'escalated';

export interface AuditFinding {
  id: string;
  employeeId: string;
  employeeName: string;
  taskId?: string;
  auditDate: string;
  severity: Severity;
  claim: string;
  evidence: string;
  requiredAction: string;
  status: FindingStatus;
  createdAt: number;
  updatedAt: number;
}
export interface AuditDocument {
  employeeId: string;
  employeeName: string;
  auditDate: string;
  findings: AuditFinding[];
  verified: number;
  escalated: number;
}
