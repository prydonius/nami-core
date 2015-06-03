#!/bin/bash
ROOT_DIR=`cd $(dirname $0) && pwd`
PID_FILE=$ROOT_DIR/tmp/service.pid
LOG_FILE=$ROOT_DIR/logs/service.log

function get_pid()
{
    echo $(cat $PID_FILE)
}

function is_service_running()
{
    if [[ -f $PID_FILE ]] && kill -0 $(get_pid) 2> /dev/null ; then
        RUNNING=1;
    else
        RUNNING=0;
    fi
    echo $RUNNING
}

if [[ $1 == "start" ]]; then
    if [[ $(is_service_running) == 1 ]]; then
        echo "Process already running";
        exit 0
    fi
    mkdir -p $ROOT_DIR/tmp/
    mkdir -p $ROOT_DIR/logs
    echo "[START] STARTING SERVICE" >> $LOG_FILE
    (
        while [[ 1 ]]; do
            date >> $LOG_FILE
            sleep 1
        done
    )& > /dev/null 2>&1
    PID=$!
    disown $PID
    echo -n $PID > $PID_FILE
fi

if [[ $1 == "stop" ]]; then
    if [[ $(is_service_running) == 1 ]]; then
        echo "[STOP] STOPPING SERVICE" >> $LOG_FILE
        kill $(get_pid)
        rm $PID_FILE
    else
        echo "Service not running"
    fi
fi

if [[ $1 == "status" ]]; then
    echo $(is_service_running)
fi
