#!/bin/bash
export JAVA_HOME="C:/Program Files/JetBrains/IntelliJ IDEA 2023.2/jbr"
export PATH="$JAVA_HOME/bin:$PATH"
cd "E:/học/học java/du-an-module6/backend"
"$JAVA_HOME/bin/java.exe" -jar target/backend-0.0.1-SNAPSHOT.jar > run.log 2>&1

