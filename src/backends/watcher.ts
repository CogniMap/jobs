const EventEmitter = require('events');

/**
 * Trigger task events.
 *
 * Methods of this class only trigger events. We define them to be able to force types of the arguments.
 */
export class TaskWatcher extends EventEmitter
{
    /**
     * The task has started.
     */
    public start()
    {
        this.emit('start');
    }

    public error(error)
    {
        this.emit('error', error);
    }

    public complete(taskHash)
    {
        this.emit('complete', taskHash);
    }

    public failed(body)
    {
        this.emit('failed', body);
    }
}