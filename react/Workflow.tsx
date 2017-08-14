import * as React from 'react';
import {Treebeard} from 'react-treebeard';
const difference = require('lodash/difference');
import * as SocketIO from 'socket.io-client';
const ReactJson = require('react-json-view').default;

import {update} from '../commons/immutability';
import {ExecutionErrorType, WorkflowTasks, Statuses, Status} from '../types';
import {Progress} from './Progress';

export namespace Workflow {
  export interface Props {
    workflowId: string;
    title: string;

    panelRenderer();   // Component renderer

    // Events handlers
    onError(err : {type: string, payload: string});
  }

  export interface State {
    workflow ?: WorkflowTasks;
    tasksStates: {
      [taskPath: string]: {
        toggled: boolean,
        active: boolean,
      }
    },
    tasksStatuses ?: Statuses;

    selectedTask ?: string; // Task path
  }
}

/**
 * Render a workflow progression.
 * Display all tasks in a tree view, with a panel for the selected task. This panel display
 * the task status and the task body.
 *
 * Tasks can be run manually.
 */
export class Workflow extends React.Component<Workflow.Props, Workflow.State> {
  private socket = null;

  public static defaultProps: Workflow.Props = {
    workflowId: null,
    title: '',

    panelRenderer: () => null,

    onError : (err) => null,
  }

  public constructor(props) {
    super(props);
    this.state = {
      workflow: [],
      tasksStatuses: {},
      tasksStates: {},

      selectedTask: null,
    };
  }

  public componentDidMount()
  {
    if (this.props.workflowId != null) {
      this.setupWorkflow(this.props.workflowId);
    }
  }

  public componentWillReceiveProps(nextProps: Workflow.Props) {
    if (nextProps.workflowId != null && nextProps.workflowId != this.props.workflowId) {
      this.setupWorkflow(nextProps.workflowId);
    }
  }

  /**
   * Create the Websocket, and register listeners if needed.
   *
   * Register the client to the workroom, and update the tasks tree upon workflow description.
   */
  private setupWorkflow(workflowId : string)
  {
    let self = this;

    if (this.socket == null) {
      let socket = this.socket = SocketIO.connect('http://localhost:3030');
      socket.on('hello', data => {
        socket.emit('watchWorkflowInstance', workflowId);
      });

      socket.on('workflowDescription', (res: {id: string, tasks: WorkflowTasks}) => {
        if (res.id == workflowId) {
          self.setState(prevState => update(prevState, {
            workflow: {$set: res.tasks}
          }));
        }
      });

      socket.on('setTasksStatuses', (res: {id: string, statuses : Statuses}) => {
        if (res.id == workflowId) {
          self.setState(prevState => update(prevState, {
            tasksStatuses: {
              $merge: res.statuses
            }
          }));
        }
      });

      socket.on('executionError', this.props.onError);
    } else {
      this.socket.emit('watchWorkflowInstance', workflowId);
    }
  }

  private executeTask(taskPath : string)
  {
    let self = this;
    if (this.socket != null) {
      this.socket.emit('executeTask', {
        workflowId: self.props.workflowId,
        taskPath,
      });
    }
  }

  public componentWillUnmount() {
    if (this.socket != null) {
      // TODO
      //this.socket.disconnect();
    }
  }

  private getStatusLabel(status : Status) : string
  {
    return '[' + status.toUpperCase() + ']';
  }

  public render()
  {
    let self = this;
    if (this.props.workflowId == null) {
      return null;
    }

    /**
     * Append the toggled/active state and the status to tasks,
     */
    function renderableWorkflow(tasks : WorkflowTasks)
    {
      return (tasks as any).map(task => {
        let status = self.state.tasksStatuses[task.path] || {
          status: "inactive",
        };
        let nodeState = self.state.tasksStates[task.path] || {
          toggled: false,
          active: false,
        };
        return Object.assign({}, task, nodeState, {
          name: self.getStatusLabel(status.status) + ' ' + task.name,
        });
      });
    }

    return (
      <div className="container">
        <h1>{this.props.title}</h1>
        <div className="row">
          <div className="col-md-6 col-sm-12">
            <Treebeard
              data={renderableWorkflow(this.state.workflow)}
              onToggle={(node, toggled) => {
                let updater = {
                  tasksStates: {
                    [node.path]: {
                      $apply: orig => ({
                        toggled: orig == null ? true : !orig.toggled,
                        active: toggled,
                      })
                    }
                  }
                };

                // Set the active task
                for (let path in self.state.tasksStates) {
                  if (path != node.path) {
                    updater.tasksStates[path] = {$merge: {active: false}};
                  }
                }
                updater['selectedTask'] = {$set: node.path};

                self.setState(update(self.state, updater));
              }}
            />
          </div>
          {this.state.selectedTask != null ? this.renderPanel(this.state.selectedTask) : null}
        </div>
      </div>
    );
  }

  public renderPanel(taskPath : string)
  {
    let self = this;
    let {body, status, context, argument} = this.state.tasksStatuses[this.state.selectedTask];

    return (
      <div className="col-md-6 col-sm-12">
        <div className="row">
          <button onClick={() => {
            self.executeTask(self.state.selectedTask);
          }}>Executer</button>
        </div>
        <div className="row">
          <div className="col-lg-12">
            {status == "ok" || status == "failed" ? (
              <div>
                <h2>{status == "ok" ? "Résultat" : "Erreur"}</h2>
                <ReactJson src={body || {}} />
                <h2>Argument</h2>
                <ReactJson src={argument || {}} />
                <h2>Contexte</h2>
                <ReactJson src={context || {}} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
}
