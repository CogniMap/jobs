import { WorkflowStatus } from './index.d';

/**
 * We build packets through functions, to make sure we always use the same protocol.
 */
export namespace Packets
{
    export function catchError(socket, promise)
    {
        promise.catch(err => {
            socket.emit('appError', {
                error: err
            });
        });
    }

    export function hello(socket)
    {
        socket.emit('hello', {});
    }

    export function setWorkflowStatus(socket, workflowId : string, status : WorkflowStatus)
    {
        socket.emit('setWorkflowStatus', {
            id: workflowId,
            status,
        });
    }

    export function setTasksStatuses(socket, workflowId, statuses)
    {
        socket.emit('setTasksStatuses', {
            id: workflowId,
            statuses,
        });
    }

    export function workflowDescription(socket, workflowId, tasks)
    {
        socket.emit('workflowDescription', {
            id: workflowId,
            tasks,
        });
    }

    export namespace Errors
    {
        export function executionError(socket, err)
        {
            socket.emit('executionError', err);
        }
    }
}