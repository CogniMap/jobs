Jobs
====

This library easily manage background jobs, and track their progress in real time.

It is composed of two parts :

- A backend, based on redis to store jobs progress and on NodeJs to trigger and execute 
these jobs.
- Frontend integrations : We try to support as many UI frameworks to display the job
progress in real time (we use WebSockets). Currently, we support the following frameworks:
  - React

# Backend

The backend works on top of an Express server.

Tasks description :
```
[
  ...
  // A simple task
  {
    name: string,
    task: (res) => Promise,

    condition ?: (res) => boolean, // If set, the task is only executed if the result is true
    debug ?: (res) => func,
    onComplete ?: (res) => string, // Will be logged
  },

  // Parallels tasks
  {
    task: (res) => Promise,

    subtasks: {
      rec ..
    },
    dest: string, // Name of the variable in the subtasks context holding the task result
                  // (ie this.dest will hold that result in subtasks functions)
  }
  ...
]
```

Any task can be run with its path (ie #.task1.subtask2 etc, where '#' stands for root tasks).
Tasks are ran under a workflow id. All results of tasks for a given workflow are stored in the
redis database (as JSON).

Also track execution time of all tasks, and make sure it is consistent during evaluation.

The following hash is stored in redis, for every task ran of a workflow execution :
```
workflowTask_<workflowId>_<taskPath>: {
  executionTime: number; // Milliseconds since epoch
  status: string; // The job status. One of : "inactive", "queued", "ok", "failed"
  body: string; // JSON string (for "ok" and "failed" states)
  executionTime: number; // Timestamps in milliseconds
}
```

Also store logs under the following list :
```
logs_<workflowId>_<taskPath>: string[]
```

How to run a workflow ?

- Setup the websocket server with setupWebsocket()
- Register a workflow with registerWorkflow()
- Create an instance with createWorkflowInstance()
- Connect to the websocket server and send the "watchWorkflowInstance" message
- The client will receive "setTasksStatues" message to update the progression

# Frontends

## React

The React integration works *out of the box*, without redux anything similar.

We use a CRUD approach : we don't want to add extra page to your application for job
progression, but instead only replace the "VIEW" or "EDIT" parts by progression when needed.

Example : 
```
/** If jobId is not null, display the progression of this job. */
<Jobify jobId={1} progression={(state : JobState) => {
  <div>
    {/** 
      The progression renderer.
      Cf the Progress component for an example.
    */}
  </div>
}} component={() => {
  <div>
    {/** Your component rendering code */}
  </div>
}} />
```
