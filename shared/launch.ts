export type LaunchSceneId = 'launch' | 'investor' | 'bug' | 'reporter' | 'celebrate';
export type LaunchStep = 'product' | 'marketing' | 'forecast' | 'revision' | 'bug' | 'reporter';
export interface LaunchScene {
  id: LaunchSceneId;
  title: string;
  status: 'locked' | 'ready' | 'running' | 'completed' | 'failed';
  sessionIds: string[];
  notificationId?: string;
  error?: string;
}
export interface LaunchCheckpoint {
  id: string;
  label: string;
  createdAt: string;
}
export interface LaunchSnapshot {
  id: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  scenes: LaunchScene[];
  checkpoints: LaunchCheckpoint[];
  projectName: 'Little Office';
  celebrationId?: string;
}
export interface LaunchAction {
  action: 'start' | 'advance' | 'restore' | 'retry';
  scene?: LaunchSceneId;
  checkpointId?: string;
}
