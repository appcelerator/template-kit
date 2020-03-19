#! groovy
library 'pipeline-library'

runNpmPackage {
  nodeVersions = [ '10.19.0', '12.16.1', '13.11.0' ]
  testEnvVars = [ 'SNOOPLOGG=*' ]
  useYarn = true
}

def runNpmPackage(Closure body) {
  def config = [:]
  body.resolveStrategy = Closure.DELEGATE_FIRST
  body.delegate = config
  body()

  def MAINLINE_BRANCH_REGEXP = /^master|\d_(\d_)?(X|\d)$/
  def isMainLineBranch = (env.BRANCH_NAME ==~ MAINLINE_BRANCH_REGEXP)
  def state = [
    artifacts: false,
    defaultNodeLabel: 'osx || linux',
    defaultNodeJSVersion: '12.16.1',
    downstream: [],
    isMainLineBranch: isMainLineBranch,
    isMaster: env.BRANCH_NAME.equals('master'),
    jiraProject: null,
    junitReportPath: 'junit.xml',
    nodeVersions: [ '12.16.1' ],
    npmVersion: 'latest',
    packageName: '',
    packageVersion: '',
    publishedData: '',
    platforms: [ 'linux', 'osx', 'windows' ],
    publish: isMainLineBranch,
    publishAsTagOnly: false,
    successThreshold: 100,
    tagGit: false,
    testCmd: '',
    testEnvVars: [],
    updateJIRATickets: false,
    useYarn: false,
    yarnVersion: 'latest'
  ]

  if (config.containsKey('publish')) {
    state.publish = config.publish
    state.updateJIRATickets = state.publish
    state.tagGit = state.publish
  }

  if (config.containsKey('artifacts'))            state.artifacts = config.artifacts
  if (config.containsKey('defaultNodeLabel'))     state.defaultNodeLabel = config.defaultNodeLabel
  if (config.containsKey('defaultNodeJSVersion')) state.defaultNodeJSVersion = config.defaultNodeJSVersion
  if (config.containsKey('downstream'))           state.downstream = config.downstream
  if (config.containsKey('jiraProject'))          state.jiraProject = config.jiraProject
  if (config.containsKey('junitReportPath'))      state.junitReportPath = config.junitReportPath
  if (config.containsKey('nodeVersions'))         state.nodeVersions = config.nodeVersions
  if (config.containsKey('npmVersion'))           state.npmVersion = config.npmVersion
  if (config.containsKey('platforms'))            state.platforms = config.platforms
  if (config.containsKey('publishAsTagOnly'))     state.publishAsTagOnly = config.publishAsTagOnly
  if (config.containsKey('successThreshold'))     state.successThreshold = config.successThreshold
  if (config.containsKey('tagGit'))               state.tagGit = config.tagGit
  if (config.containsKey('testCmd'))              state.testCmd = config.testCmd
  if (config.containsKey('testEnvVars'))          state.testEnvVars = config.testEnvVars
  if (config.containsKey('updateJIRATickets'))    state.updateJIRATickets = config.updateJIRATickets
  if (config.containsKey('useYarn'))              state.useYarn = config.useYarn
  if (config.containsKey('yarnVersion'))          state.yarnVersion = config.yarnVersion

  timestamps {
    node(state.defaultNodeLabel) {
      nodejs(nodeJSInstallationName: "node ${state.defaultNodeJSVersion}") {
        ansiColor('xterm') {
          timeout(60) {

            def isWindows = !isUnix()

            stage('Checkout') {
              checkout([
                $class: 'GitSCM',
                branches: scm.branches,
                extensions: scm.extensions + [
                  // check out to local branch so greenkeeper-lockfile-upload can work!
                  [$class: 'LocalBranch', localBranch: '**'],
                  // do a git clean -fdx first to wipe any local changes during last build
                  [$class: 'CleanBeforeCheckout'],
                  // if there are submodules recursively update them (and use the credentials from the main repo clone/checkout)
                  [$class: 'SubmoduleOption', disableSubmodules: false, parentCredentials: true, recursiveSubmodules: true, reference: '', trackingSubmodules: false]
                ],
                userRemoteConfigs: scm.userRemoteConfigs
              ])

              if (state.publish && state.publishAsTagOnly) {
                // bumps number after - in package.json!
                if (isWindows) {
                  bat 'npm version prerelease'
                } else {
                  sh 'npm version prerelease'
                }
              }

              def packageJSON = jsonParse(readFile('package.json'))
              def coverage = packageJSON['scripts'] && packageJSON['scripts']['coverage']
              state.packageName = packageJSON['name']
              state.packageVersion = packageJSON['version']
              currentBuild.displayName = "#${state.packageVersion}-${currentBuild.number}"

              if (!state.useYarn) {
                state.useYarn = !fileExists('npm-shrinkwrap.json') && !fileExists('package-lock.json') && fileExists('yarn.lock')
              }

              // always require npm
              ensureNPM(state.npmVersion)

              if (state.useYarn) {
                ensureYarn(state.npmVersion)
              }

              // install npm dependencies
              if (state.useYarn) {
                if (isWindows) {
                  bat 'yarn install --production'
                } else {
                  sh 'yarn install --production'
                }
              } else {
                if (isWindows) {
                  bat 'npm install --production'
                } else {
                  sh 'npm install --production'
                }
              }

              // if ther'es not a test command, then auto-detect if there's a coverage script
              if (state.testCmd.isEmpty()) {
                if (state.useYarn) {
                  state.testCmd = coverage ? 'yarn run coverage' : 'yarn test'
                } else {
                  state.testCmd = coverage ? 'npm run coverage' : 'npm test'
                }
              }

              if (state.publish) {
                try {
                  state.publishedData = sh(returnStdout: true, script: "npm view ${state.packageName}@${state.packageVersion} --json").trim()
                } catch (err) {
                  // assume the command failed because the package doesn't exist yet
                  state.publishedData = ''
                }

                if (state.publishedData.isEmpty()) {
                  stash allowEmpty: true, name: 'sources', useDefaultExcludes: false
                }
              }
            } // checkout

            stage('Security') {
              if (state.useYarn) {
                if (isWindows) {
                  bat returnStatus: true, script: 'yarn audit'
                } else {
                  sh returnStatus: true, script: 'yarn audit'
                }
              } else {
                npmAuditToWarnings() // runs npm audit --json, converts to format needed by scanner and writes to npm-audit.json file
                recordIssues blameDisabled: true, enabledForFailure: true, forensicsDisabled: true, tools: [issues(name: 'NPM Audit', pattern: 'npm-audit.json')]
              }
            }

          } //timeout
        } // ansiColor
      } //nodejs
    } // checkout

    stage('Test') {
      def platformNames = [
        'linux': 'Linux',
        'osx': 'macOS',
        'windows': 'Windows'
      ]
      def matrix = [ failFast: false ]
      def totalCount = 0
      def successCount = 0

      state.platforms.each { platform ->
        state.nodeVersions.each { nodeVersion ->
          totalCount++
          matrix["${platformNames[platform]} + Node.js ${nodeVersion}"] = { ->
            node("${platform} && git && !master") {
              nodejs(nodeJSInstallationName: "node ${nodeVersion}") {
                ansiColor('xterm') {
                  timeout(60) {
                    runTests(state)
                    successCount++
                  } // timeout
                } // ansiColors
              } // nodejs
            } // node
          }
        }
      }

      try {
        parallel matrix
      } catch (e) {
        print "At least one test failed: ${e.toString()}"
      } finally {
        def failedCount = totalCount - successCount
        def successRatio = successCount / totalCount
        def threshold = state.successThreshold / 100

        print "Count test count = ${totalCount}"
        print "Successful tests = ${successCount}"
        print "Failed tests = ${failedCount}"
        print "Success ratio = ${successRatio}"
        print "Threshold = ${threshold}"

        if (successRatio < threshold) {
          error "Number of failed tests (${failedCount}) exceeded threshold"
        }
      }
    } // test

    stage('Publish') {
      if (state.publishedData.isEmpty()) {
        node(state.defaultNodeLabel) {
          nodejs(nodeJSInstallationName: "node ${state.defaultNodeJSVersion}") {
            ansiColor('xterm') {
              timeout(60) {

                def isWindows = !isUnix()

                unstash 'sources'
                ensureNPM(state.npmVersion)

                // if (state.publishAsTagOnly) { // don't push as 'latest'
                //     if (isWindows) {
                //       bat "npm publish --tag=${state.packageVersion.replaceAll('\\.', '_')}"
                //     } else {
                //       sh "npm publish --tag=${state.packageVersion.replaceAll('\\.', '_')}"
                //     }
                // } else { // push as 'latest'
                //   if (isWindows) {
                //     bat 'npm publish'
                //   } else {
                //     sh 'npm publish'
                //   }
                // }

                // don't try to tag and push unless we successfully published, or else we may overwrite existing tag for a previously published version
                // if (state.tagGit) {
                //   pushGitTag(name: state.packageVersion, force: true, message: "See ${env.BUILD_URL} for more information.")
                // }

                // if (state.publishAsTagOnly) {
                //   pushGit(force: true) // even if we're not tagging, we did bump the version above, so we should push that
                // }

                // if (state.updateJIRATickets) {
                //   updateJIRA(state.jiraProject, "${state.packageName} ${state.packageVersion}", scm)
                // }

                addBadge text: "Published ${state.packageName} v${state.packageVersion}", icon: 'star-gold.png', link: "https://www.npmjs.com/package/${state.packageName}/v/${state.packageVersion}"

              } // timeout
            } // ansiColor
          } // nodejs
        } // node
      } else {
        print "Package ${state.packageName} v${state.packageVersion} already published, skipping"
      }
    } // publish

    if (state.isMainLineBranch) {
      for (i = 0; i < state.downstream.size(); i++) {
        build job: "${state.downstream[i]}/${env.BRANCH_NAME}", wait: false, parameters: [
          [$class: 'StringParameterValue', name: 'packageName', value: state.packageName ],
          [$class: 'StringParameterValue', name: 'packageVersion', value: state.packageVersion ],
        ]
      }
    }
  } // timestamps
}

def runTests(state) {
  def isWindows = !isUnix()

  if (isWindows) {
    bat 'node -e "console.log(process.env)"'
  } else {
    sh 'node -e "console.log(process.env)"'
  }

  checkout([
    $class: 'GitSCM',
    branches: scm.branches,
    extensions: scm.extensions + [
      // check out to local branch so greenkeeper-lockfile-upload can work!
      [$class: 'LocalBranch', localBranch: '**'],
      // do a git clean -fdx first to wipe any local changes during last build
      [$class: 'CleanBeforeCheckout'],
      // If there are submodules recursively update them (and use the credentials from the main repo clone/checkout)
      [$class: 'SubmoduleOption', disableSubmodules: false, parentCredentials: true, recursiveSubmodules: true, reference: '', trackingSubmodules: false]
    ],
    userRemoteConfigs: scm.userRemoteConfigs
  ])

  if (isWindows) {
    // force unix line endings so linting doesn't blow up
    bat 'git config core.autocrlf false && git config core.eof lf && git rm --cached -r -q . && git reset --hard -q'
    bat 'git submodule foreach "git config core.autocrlf false && git config core.eof lf && git rm --cached -r -q . && git reset --hard -q"'
  }

  // always require npm
  ensureNPM(state.npmVersion)

  if (state.useYarn) {
    ensureYarn(state.yarnVersion)
    if (isWindows) {
      bat 'yarn'
    } else {
      sh 'yarn'
    }
  } else {
    if (isWindows) {
      bat 'npm ci'
    } else {
      sh 'npm ci'
    }
  }

  fingerprint 'package.json'

  try {
    // set special env var so we don't try test requiring sudo prompt
    def envVars = [ 'JENKINS=true' ]

    if (state.testEnvVars) {
      envVars += state.testEnvVars
    }

    withEnv(envVars) {
      if (isWindows) {
        bat state.testCmd
      } else {
        sh state.testCmd
      }
    }
  } finally {
    // record results even if tests/coverage 'fails'
    // try to record if:
    // path is a pattern (has '*')
    // OR path may refer to multiple files (has ',')
    // OR path refers to a file that exists
    def recordTestResults = state.junitReportPath.contains('*') || state.junitReportPath.contains(',') || fileExists(state.junitReportPath)
    if (recordTestResults) {
      junit state.junitReportPath
    }

    if (fileExists('coverage/cobertura-coverage.xml')) {
      step([$class: 'CoberturaPublisher', autoUpdateHealth: false, autoUpdateStability: false, coberturaReportFile: 'coverage/cobertura-coverage.xml', failUnhealthy: false, failUnstable: false, maxNumberOfBuilds: 0, onlyStable: false, sourceEncoding: 'ASCII', zoomCoverageChart: false])
    }
  } // try

  if (state.artifacts) {
    archiveArtifacts state.artifacts
  }
} // runTests
