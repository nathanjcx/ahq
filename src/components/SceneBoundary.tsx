import { Component } from 'react';
import type { ReactNode } from 'react';
import { Users } from 'lucide-react';
export default class SceneBoundary extends Component<
  { children: ReactNode; onTeam: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="scene-loading scene-fallback">
          <Users size={30} />
          <strong>Your team is still right here.</strong>
          <p>The 3D view isn’t available on this device.</p>
          <button className="button secondary" onClick={this.props.onTeam}>
            Open the employee list
          </button>
        </div>
      );
    return this.props.children;
  }
}
