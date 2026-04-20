// shared/store.js
// Central shared state — imported by all pages so they share live data

import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchTasks, fetchTask, submitTicket, connectToTask, fetchHealth, fetchAwsStatus, fetchConfig } from '../utils/api'

// AWS pricing per hour
export const PRICING = {
  't2.nano':0.0058, 't2.micro':0.0116, 't2.small':0.023,
  't2.medium':0.0464, 't2.large':0.0928, 't3.medium':0.0416, 't3.large':0.0832
}

// Service catalog
export const CATALOG = [
  { id:'payments', icon:'💳', name:'Payments API',   env:'production',  color:'#00c8e8',
    desc:'PCI-compliant payment processing',
    ticket:'Set up a production environment for our payments service. S3 bucket in us-east-1, t2.medium EC2 instance, deploy payments-api Docker container on port 8080.' },
  { id:'auth',     icon:'🔐', name:'Auth Service',   env:'staging',     color:'#b388ff',
    desc:'JWT authentication & session management',
    ticket:'Create a staging environment for the auth service. S3 storage in us-east-1, t2.medium compute, deploy auth-service:latest on port 3000.' },
  { id:'ml',       icon:'🤖', name:'ML Pipeline',    env:'development', color:'#ffab40',
    desc:'Real-time inference engine',
    ticket:'Provision a dev environment for the ML inference pipeline. S3 bucket for model artifacts, EC2 t2.large instance, deploy ml-inference container on port 5000.' },
  { id:'web',      icon:'🌐', name:'Web Frontend',   env:'production',  color:'#00e676',
    desc:'React SPA with CDN asset delivery',
    ticket:'Deploy a production web frontend. S3 bucket for static assets in us-east-1, t2.small compute instance, deploy web-app:latest on port 80.' },
  { id:'data',     icon:'🗃️', name:'Data Pipeline',  env:'staging',     color:'#ff5252',
    desc:'ETL pipeline for analytics',
    ticket:'Set up staging environment for data pipeline. S3 bucket for raw data in us-east-1, t2.large EC2 instance, deploy data-pipeline:latest on port 9000.' },
]

export function estimateCost(task) {
  const compute = task?.steps?.find(s => s.tool === 'allocate_compute')
  const type = compute?.output?.instance_type || compute?.params?.instance_type || 't2.medium'
  const h = PRICING[type] || 0.0464
  return { hourly: h, monthly: +(h * 730).toFixed(2), total: +(h * 730 + 0.02).toFixed(2) }
}

export function getEndpoint(task) {
  return task?.final_report?.public_url
    || task?.final_report?.endpoint
    || task?.public_url
    || task?.steps?.find(s => s.tool === 'deploy_service')?.output?.endpoint
    || null
}

export function getInstanceId(task) {
  return task?.final_report?.instance_id || task?.instance_id || task?.steps?.find(s => s.tool === 'allocate_compute')?.output?.instance_id || null
}

export function getCatalogItem(task) {
  const t = (task?.ticket || '').toLowerCase()
  return CATALOG.find(c => t.includes(c.id) || t.includes(c.name.toLowerCase().split(' ')[0])) || null
}

export function msToS(ms) {
  if (!ms) return '—'
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

export function timeAgo(iso) {
  if (!iso) return '—'
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60)   return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

export const STATUS_COLOR = s => ({
  pending:'#3a5570', queued:'#3a5570', planning:'#00c8e8', running:'#00c8e8',
  executing:'#00c8e8', retrying:'#ffab40', cancelling:'#ff9800',
  completed:'#00e676', verified:'#00e676', failed:'#ff5252', cancelled:'#ff5252'
}[s] || '#3a5570')

// ── Global task store hook ────────────────────────────────────────────────
export function useTaskStore() {
  const [tasks, setTasks]             = useState([])
  const [activeTaskId, setActiveTaskId] = useState(null)
  const [activeTask, setActiveTask]   = useState(null)
  const [activeLogs, setActiveLogs]   = useState([])
  const [deploying, setDeploying]     = useState(false)
  const [deployingTargetId, setDeployingTargetId] = useState(null)
  const [backendHealthy, setBackendHealthy] = useState(false)
  const [appConfig, setAppConfig] = useState(null)
  const [awsStatus, setAwsStatus] = useState(null)
  const wsRef = useRef(null)

  // Poll all tasks
  useEffect(() => {
    const load = () => fetchTasks().then(t => setTasks(t || [])).catch(() => {})
    load()
    const iv = setInterval(load, 6000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    let mounted = true
    const loadHealth = async () => {
      const healthy = await fetchHealth()
      if (mounted) setBackendHealthy(healthy)
    }
    loadHealth()
    const iv = setInterval(loadHealth, 15000)
    return () => {
      mounted = false
      clearInterval(iv)
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const loadAws = async () => {
      if (!backendHealthy) {
        if (mounted) setAwsStatus(null)
        return
      }
      const status = await fetchAwsStatus()
      if (mounted) setAwsStatus(status)
    }
    loadAws()
    const iv = setInterval(loadAws, 20000)
    return () => {
      mounted = false
      clearInterval(iv)
    }
  }, [backendHealthy])

  useEffect(() => {
    let mounted = true
    const loadConfig = async () => {
      const config = await fetchConfig()
      if (mounted) setAppConfig(config)
    }
    loadConfig()
    const iv = setInterval(loadConfig, 30000)
    return () => {
      mounted = false
      clearInterval(iv)
    }
  }, [])

  const runtimeMode = appConfig?.runtime_mode || appConfig?.execution_mode || awsStatus?.execution_mode
  const systemMode = !backendHealthy
    ? 'offline'
    : runtimeMode === 'real'
      ? 'real'
      : 'mock'

  // Connect WebSocket when active task changes
  useEffect(() => {
    if (!activeTaskId) return
    if (!backendHealthy) return
    if (wsRef.current) wsRef.current.close()
    setActiveLogs([])

    fetchTask(activeTaskId).then(t => {
      if (!t) return
      setActiveTask(t)
      setTasks(prev => prev.some(x => x.task_id === t.task_id)
        ? prev.map(x => x.task_id === t.task_id ? t : x)
        : [t, ...prev])
    }).catch(() => {})

    const ws = connectToTask(activeTaskId, msg => {
      if (msg.type === 'state' || msg.type === 'update') {
        setActiveTask(msg.data)
        setTasks(prev => prev.map(t => t.task_id === msg.data.task_id ? msg.data : t))
      }
      if (msg.type === 'log') {
        setActiveLogs(prev => [...prev, {
          id: Date.now() + Math.random(),
          message: msg.data.message,
          level: msg.data.level,
          ts: new Date().toISOString()
        }])
      }
    }, () => {})

    wsRef.current = ws
    return () => { ws.close(); wsRef.current = null }
  }, [activeTaskId, backendHealthy])

  const deploy = useCallback(async (ticketText, priority = 3, targetId = null) => {
    setDeploying(true)
    setDeployingTargetId(targetId)
    setActiveLogs([])
    try {
      const { task_id } = await submitTicket(ticketText, priority)
      setActiveTaskId(task_id)
      fetchTasks().then(t => setTasks(t || [])).catch(() => {})
      return task_id
    } catch (e) {
      throw e  // Re-throw so caller can handle with structured error
    } finally {
      setDeploying(false)
      setDeployingTargetId(null)
    }
  }, [])

  return {
    tasks,
    activeTaskId,
    setActiveTaskId,
    activeTask,
    activeLogs,
    deploying,
    deployingTargetId,
    deploy,
    backendHealthy,
    appConfig,
    awsStatus,
    systemMode,
  }
}
