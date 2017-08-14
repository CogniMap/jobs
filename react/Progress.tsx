import * as React from 'react';

const ProgressLine = require('rc-progress').Line;
require('rc-progress/assets/index.less');


export namespace Progress {
	export interface Props {
    progress: number;
    color: string;
    logs: string[];
	}

	export interface State {
	}
}

/**
 * Default job progression display.
 */
export class Progress extends React.Component<Progress.Props, Progress.State>
{
  public render()
  {
		return (
			<div className="col-full text-center job">
				<div style={{margin: "10px"}} >
					<ProgressLine style={{marginTop: "10px"}} percent={this.props.progress } trailWidth="4" strokeWidth="4" strokeColor={this.props.color} />
				</div>
				<p className="text-center" style={{fontWeight: "bold"}}>
          {this.props.logs.map((log, i) => (
            <span key={i}>{log}<br/></span>
          ))}
				</p>
				<br/>
			</div>
		);
  }
}
